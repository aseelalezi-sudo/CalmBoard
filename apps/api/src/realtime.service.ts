import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import type { Server } from "socket.io";
import type { DatabaseRequestContext } from "@calmboard/database";
import type { AuthenticatedRequest } from "./auth.guard.js";
import type { RealtimeScope } from "./realtime-access.service.js";
import { RealtimeAccessService } from "./realtime-access.service.js";
import { AuthService } from "./auth.service.js";

type MutationRequest = AuthenticatedRequest & {
  body?: unknown;
  query?: unknown;
  params?: unknown;
  tenant?: { organizationId: string; workspaceId?: string; projectId?: string };
};

export type RealtimePresence = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type RealtimeEvent = {
  id: string;
  schemaVersion: 1;
  version: number;
  type: "workspace.changed";
  action: "created" | "updated" | "deleted";
  resource: string;
  scope: RealtimeScope;
  occurredAt: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalIdentifier(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function realtimeRoom(scope: Pick<RealtimeScope, "organizationId"> & Partial<RealtimeScope>, level: string) {
  if (level === "organization") return `organization:${scope.organizationId}`;
  if (!scope.workspaceId) throw new Error("workspaceId is required for this realtime room");
  if (level === "workspace") return `workspace:${scope.organizationId}:${scope.workspaceId}`;
  if (level === "project" && scope.projectId) {
    return `project:${scope.organizationId}:${scope.workspaceId}:${scope.projectId}`;
  }
  if (level === "task" && scope.taskId) {
    return `task:${scope.organizationId}:${scope.workspaceId}:${scope.taskId}`;
  }
  throw new Error(`Invalid realtime room level: ${level}`);
}

export function realtimeRooms(scope: RealtimeScope) {
  return [
    realtimeRoom(scope, "organization"),
    ...(scope.workspaceId ? [realtimeRoom(scope, "workspace")] : []),
    ...(scope.projectId ? [realtimeRoom(scope, "project")] : []),
    ...(scope.taskId ? [realtimeRoom(scope, "task")] : []),
  ];
}

function mutationAction(method: string): RealtimeEvent["action"] {
  if (method === "DELETE") return "deleted";
  if (method === "POST") return "created";
  return "updated";
}

function mutationScope(
  request: MutationRequest,
  context: DatabaseRequestContext,
  result?: unknown,
): RealtimeScope | null {
  if (!context.organizationId) return null;
  const body = record(request.body);
  const query = record(request.query);
  const params = record(request.params);
  const path = request.url.split("?", 1)[0] ?? request.url;
  const resource = path.split("/").filter(Boolean)[0] ?? "";
  const committed = record(result);
  const projectId = optionalIdentifier(
    request.tenant?.projectId,
    resource === "projects" ? params.id : undefined,
    resource === "projects" ? committed.id : undefined,
    body.projectId,
    query.projectId,
  );
  const taskId = optionalIdentifier(
    body.taskId,
    query.taskId,
    resource === "tasks" ? body.id : undefined,
    resource === "tasks" ? params.id : undefined,
    /^\/tasks\/?$/.test(path) ? committed.id : undefined,
  );
  return {
    organizationId: context.organizationId,
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(taskId ? { taskId } : {}),
  };
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RealtimeAccessService) private readonly access: RealtimeAccessService,
  ) {}
  private server?: Server;
  private readonly versions = new Map<string, number>();
  private readonly redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : undefined;

  attachServer(server: Server) {
    this.server = server;
  }

  private versionKey(scope: RealtimeScope) {
    return `calmboard:realtime:version:${scope.organizationId}:${scope.workspaceId ?? "organization"}`;
  }

  async currentVersion(scope: RealtimeScope) {
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        return Number((await this.redis.get(this.versionKey(scope))) ?? 0);
      } catch {
        // Local fallback keeps development usable if Redis is restarted.
      }
    }
    return this.versions.get(this.versionKey(scope)) ?? 0;
  }

  private async nextVersion(scope: RealtimeScope) {
    if (this.redis) {
      try {
        if (this.redis.status === "wait") await this.redis.connect();
        return await this.redis.incr(this.versionKey(scope));
      } catch {
        // A committed HTTP mutation must still return even if realtime is degraded.
      }
    }
    const key = this.versionKey(scope);
    const next = Math.max((this.versions.get(key) ?? 0) + 1, Date.now() * 1_000);
    this.versions.set(key, next);
    return next;
  }

  private async authorizedSockets(scope: RealtimeScope, rooms = realtimeRooms(scope)) {
    if (!this.server) return [];
    const sockets = await this.server.in(rooms).fetchSockets();
    const allowed = [];
    for (const socket of sockets) {
      try {
        const user = socket.data.user as RealtimePresence | undefined;
        const sessionId = socket.data.sessionId as string | undefined;
        if (!user?.id || !sessionId) continue;
        const session = await this.auth.currentRealtimeSession(sessionId, user.id);
        if (user?.id !== session.user.id) continue;
        await this.access.authorizeDelivery(user.id, scope);
        socket.data.user = {
          id: session.user.id,
          name: session.user.name,
          ...(session.user.avatarUrl ? { avatarUrl: session.user.avatarUrl } : {}),
        };
        allowed.push(socket);
      } catch {
        /* Fail closed for expired sessions, removed members and transient authorization failures. */
      }
    }
    return allowed;
  }

  async publishHttpMutation(request: MutationRequest, context: DatabaseRequestContext, result?: unknown) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) return;
    const scope = mutationScope(request, context, result);
    if (!scope || !this.server) return;
    const path = request.url.split("?", 1)[0] ?? request.url;
    const resource = path.split("/").filter(Boolean)[0] ?? "workspace";
    const event: RealtimeEvent = {
      id: randomUUID(),
      schemaVersion: 1,
      version: await this.nextVersion(scope),
      type: "workspace.changed",
      action: mutationAction(request.method.toUpperCase()),
      resource,
      scope,
      occurredAt: new Date().toISOString(),
    };
    try {
      const sockets = await this.authorizedSockets(scope);
      for (const socket of sockets) socket.emit("realtime:event", event);
    } catch {
      /* A realtime adapter failure must not turn a committed mutation into an HTTP error. */
    }
  }

  async presence(scope: RealtimeScope): Promise<RealtimePresence[]> {
    if (!this.server || !scope.workspaceId) return [];
    const sockets = await this.authorizedSockets(
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      [realtimeRoom(scope, "workspace")],
    );
    const users = new Map<string, RealtimePresence>();
    for (const socket of sockets) {
      const user = socket.data.user as RealtimePresence | undefined;
      if (user?.id) users.set(user.id, user);
    }
    return [...users.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async publishPresence(scope: RealtimeScope) {
    if (!this.server || !scope.workspaceId) return null;
    const presence = await this.presence(scope);
    const snapshot = {
      id: randomUUID(),
      schemaVersion: 1,
      version: await this.nextVersion(scope),
      workspaceId: scope.workspaceId,
      users: presence,
      occurredAt: new Date().toISOString(),
    } as const;
    const sockets = await this.authorizedSockets(
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      [realtimeRoom(scope, "workspace")],
    );
    for (const socket of sockets) socket.emit("realtime:presence", snapshot);
    return snapshot;
  }

  async onModuleDestroy() {
    if (this.redis?.status === "ready") await this.redis.quit();
    else this.redis?.disconnect();
  }
}
