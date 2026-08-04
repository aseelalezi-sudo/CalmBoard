import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ProfileSessionsController } from "./account.controller";
import type { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.guard";

describe("profile session controller", () => {
  it("uses only the identity attached by the authentication guard", async () => {
    const calls: Array<{ operation: string; values: string[] }> = [];
    const auth = {
      listSessions: async (userId: string, sessionId: string) => {
        calls.push({ operation: "list", values: [userId, sessionId] });
        return [];
      },
      revokeSession: async (userId: string, currentSessionId: string, sessionId: string) => {
        calls.push({ operation: "one", values: [userId, currentSessionId, sessionId] });
        return { revokedCurrent: false };
      },
      revokeOtherSessions: async (userId: string, currentSessionId: string) => {
        calls.push({ operation: "other", values: [userId, currentSessionId] });
        return { revoked: 2, revokedCurrent: false };
      },
      revokeAllSessions: async (userId: string) => {
        calls.push({ operation: "all", values: [userId] });
        return { revoked: 3, revokedCurrent: true };
      },
    } as unknown as AuthService;
    const controller = new ProfileSessionsController(auth);
    const request = { auth: { userId: "trusted-user", sessionId: "trusted-session" } } as AuthenticatedRequest;
    const headers: Array<{ name: string; value: unknown }> = [];
    const response = {
      header(name: string, value: unknown) {
        headers.push({ name, value });
      },
    } as unknown as FastifyReply;

    await controller.list(request);
    await controller.delete({ id: "target-session", userId: "attacker-user" }, request, response);
    await controller.delete({ allExceptCurrent: true, currentSessionId: "attacker-session" }, request, response);
    await controller.delete({ all: true, userId: "attacker-user" }, request, response);

    assert.deepEqual(calls, [
      { operation: "list", values: ["trusted-user", "trusted-session"] },
      { operation: "one", values: ["trusted-user", "trusted-session", "target-session"] },
      { operation: "other", values: ["trusted-user", "trusted-session"] },
      { operation: "all", values: ["trusted-user"] },
    ]);
    assert.equal(headers.at(-1)?.name, "Set-Cookie");
  });

  it("rejects direct invocation without a trusted identity", () => {
    const controller = new ProfileSessionsController({} as AuthService);
    assert.throws(() => controller.list({} as AuthenticatedRequest), UnauthorizedException);
  });
});
