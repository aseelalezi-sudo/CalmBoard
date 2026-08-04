import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { io, type Socket } from "socket.io-client";
import {
  createAuthIdentityRepository,
  createAuthSessionsRepository,
  createWorkspaceDirectoryRepository,
  pool,
} from "@calmboard/database";
import { SignJWT } from "jose";
import { AppModule } from "../src/app.module.js";
import { ACCESS_COOKIE } from "../src/auth.guard.js";
import { RealtimeService } from "../src/realtime.service.js";

type JoinResult = {
  ok: boolean;
  error?: string;
  version?: number;
  scope?: { organizationId: string; workspaceId: string };
  presence?: Array<{ id: string; name: string }>;
};

function connect(url: string, accessToken: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = io(`${url}/realtime`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { cookie: `${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}` },
      timeout: 5_000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => {
      socket.disconnect();
      reject(error);
    });
  });
}

function join(socket: Socket, scope: { organizationId: string; workspaceId: string }) {
  return new Promise<JoinResult>((resolve) => {
    socket.timeout(5_000).emit("realtime:join", scope, (error: Error | null, result: JoinResult) => {
      resolve(error ? { ok: false, error: error.message } : result);
    });
  });
}

async function cleanupFixtures(userIds: string[], organizationIds: string[]) {
  if (organizationIds.length) {
    await pool.query("delete from memberships where organization_id = any($1::uuid[])", [organizationIds]);
    await pool.query("delete from workspaces where organization_id = any($1::uuid[])", [organizationIds]);
    await pool.query("update organizations set owner_id = null where id = any($1::uuid[])", [organizationIds]);
    await pool.query("delete from organizations where id = any($1::uuid[])", [organizationIds]);
  }
  if (userIds.length) {
    await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
  }
}

async function createIdentityFixture(input: {
  email: string;
  name: string;
  organizationName: string;
  workspaceName: string;
}) {
  const identity = await createAuthIdentityRepository().register({
    ...input,
    passwordHash: "integration-test-password-hash",
  });
  const session = await createAuthSessionsRepository().create({
    userId: identity.user.id,
    device: "Realtime integration test",
  });
  const accessToken = await new SignJWT({ type: "access", sid: session.session.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(identity.user.id)
    .setIssuer("calmboard-api")
    .setAudience("calmboard-web")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.AUTH_TOKEN_SECRET!));
  return { ...identity, accessToken };
}

describe("realtime Socket.IO isolation", () => {
  after(async () => {
    await pool.end();
  });

  it("authenticates the session and never delivers another organization's events", { timeout: 30_000 }, async () => {
    const staleUsers = await pool.query<{ id: string }>(
      "select id from users where email like 'realtime-%@example.test'",
    );
    const staleUserIds = staleUsers.rows.map((row) => row.id);
    const staleOrganizations = staleUserIds.length
      ? await pool.query<{ id: string }>("select id from organizations where owner_id = any($1::uuid[])", [
          staleUserIds,
        ])
      : { rows: [] };
    await cleanupFixtures(
      staleUserIds,
      staleOrganizations.rows.map((row) => row.id),
    );

    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen({ port: 0, host: "127.0.0.1" });

    const realtime = app.get(RealtimeService);
    const suffix = randomUUID();
    const createdUserIds: string[] = [];
    const createdOrganizationIds: string[] = [];
    let firstSocket: Socket | undefined;
    let secondSocket: Socket | undefined;
    try {
      const first = await createIdentityFixture({
        email: `realtime-a-${suffix}@example.test`,
        name: "Realtime A",
        organizationName: `Realtime organization A ${suffix}`,
        workspaceName: "Realtime workspace A",
      });
      const second = await createIdentityFixture({
        email: `realtime-b-${suffix}@example.test`,
        name: "Realtime B",
        organizationName: `Realtime organization B ${suffix}`,
        workspaceName: "Realtime workspace B",
      });
      createdUserIds.push(first.user.id, second.user.id);

      const [firstDirectory, secondDirectory] = await Promise.all([
        createWorkspaceDirectoryRepository(first.user.id).listAccessible(),
        createWorkspaceDirectoryRepository(second.user.id).listAccessible(),
      ]);
      const firstWorkspace = firstDirectory.workspaces[0]!;
      const secondWorkspace = secondDirectory.workspaces[0]!;
      createdOrganizationIds.push(firstWorkspace.organizationId, secondWorkspace.organizationId);

      const url = await app.getUrl();
      [firstSocket, secondSocket] = await Promise.all([
        connect(url, first.accessToken),
        connect(url, second.accessToken),
      ]);

      const firstJoin = await join(firstSocket, {
        organizationId: firstWorkspace.organizationId,
        workspaceId: firstWorkspace.id,
      });
      assert.equal(firstJoin.ok, true);
      assert.deepEqual(firstJoin.scope, {
        organizationId: firstWorkspace.organizationId,
        workspaceId: firstWorkspace.id,
      });
      assert.equal(typeof firstJoin.version, "number");
      assert.deepEqual(firstJoin.presence, [{ id: first.user.id, name: first.user.name }]);

      const secondJoin = await join(secondSocket, {
        organizationId: secondWorkspace.organizationId,
        workspaceId: secondWorkspace.id,
      });
      assert.equal(secondJoin.ok, true);
      assert.deepEqual(secondJoin.scope, {
        organizationId: secondWorkspace.organizationId,
        workspaceId: secondWorkspace.id,
      });
      assert.equal(typeof secondJoin.version, "number");
      assert.deepEqual(secondJoin.presence, [{ id: second.user.id, name: second.user.name }]);

      const denied = await join(firstSocket, {
        organizationId: secondWorkspace.organizationId,
        workspaceId: secondWorkspace.id,
      });
      assert.deepEqual(denied, { ok: false, error: "Realtime tenant access is denied" });

      let leaked = false;
      secondSocket.on("realtime:event", () => {
        leaked = true;
      });
      const delivered = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Authorized realtime event was not delivered")), 5_000);
        firstSocket!.once("realtime:event", (event) => {
          clearTimeout(timeout);
          resolve(event);
        });
      });
      await realtime.publishHttpMutation(
        {
          method: "PATCH",
          url: "/tasks",
          body: { id: randomUUID() },
        } as never,
        {
          organizationId: firstWorkspace.organizationId,
          workspaceId: firstWorkspace.id,
          actorId: first.user.id,
        },
      );
      const event = await delivered;
      assert.equal((event.scope as { organizationId: string }).organizationId, firstWorkspace.organizationId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(leaked, false);
    } finally {
      firstSocket?.disconnect();
      secondSocket?.disconnect();
      await app.close();
      await cleanupFixtures(createdUserIds, createdOrganizationIds);
    }
  });
});
