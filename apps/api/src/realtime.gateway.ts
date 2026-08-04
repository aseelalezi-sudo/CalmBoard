import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { Inject } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { AuthService } from "./auth.service.js";
import { ACCESS_COOKIE, parseCookies } from "./auth.guard.js";
import { RealtimeAccessService, type RealtimeScope } from "./realtime-access.service.js";
import { realtimeRooms, RealtimeService, type RealtimePresence } from "./realtime.service.js";

type SocketData = {
  user?: RealtimePresence;
  subscriptions?: Record<string, RealtimeScope>;
};

type RealtimeSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

function subscriptionKey(scope: RealtimeScope) {
  return scope.workspaceId ? `${scope.organizationId}:${scope.workspaceId}` : `organization:${scope.organizationId}`;
}

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket", "polling"],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RealtimeAccessService) private readonly access: RealtimeAccessService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attachServer(server);
    server.use(async (socket: RealtimeSocket, next) => {
      try {
        const accessToken = parseCookies(socket.handshake.headers.cookie)[ACCESS_COOKIE];
        if (!accessToken) throw new Error("Authentication is required");
        const session = await this.auth.current(accessToken);
        socket.data.user = {
          id: session.user.id,
          name: session.user.name,
          ...(session.user.avatarUrl ? { avatarUrl: session.user.avatarUrl } : {}),
        };
        socket.data.subscriptions = {};
        next();
      } catch {
        next(new Error("Authentication session is invalid or expired"));
      }
    });
  }

  @SubscribeMessage("realtime:join")
  async join(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() input: unknown) {
    const user = socket.data.user;
    if (!user) return { ok: false as const, error: "Authentication is required" };
    try {
      const scope = await this.access.authorize(user.id, input);
      const key = subscriptionKey(scope);
      const previous = socket.data.subscriptions?.[key];
      if (previous) await Promise.all(realtimeRooms(previous).map((room) => socket.leave(room)));
      await socket.join(realtimeRooms(scope));
      socket.data.subscriptions = { ...socket.data.subscriptions, [key]: scope };
      const snapshot = await this.realtime.publishPresence(scope);
      const version = snapshot?.version ?? (await this.realtime.currentVersion(scope));
      return { ok: true as const, scope, version, presence: snapshot?.users ?? [] };
    } catch {
      return { ok: false as const, error: "Realtime tenant access is denied" };
    }
  }

  @SubscribeMessage("realtime:leave")
  async leave(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() input: unknown) {
    const user = socket.data.user;
    if (!user) return { ok: false as const };
    try {
      const scope = await this.access.authorize(user.id, input);
      const key = subscriptionKey(scope);
      const previous = socket.data.subscriptions?.[key];
      if (previous) {
        await Promise.all(realtimeRooms(previous).map((room) => socket.leave(room)));
        delete socket.data.subscriptions?.[key];
        await this.realtime.publishPresence(previous);
      }
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  }

  handleDisconnect(socket: RealtimeSocket) {
    const subscriptions = Object.values(socket.data.subscriptions ?? {});
    setTimeout(() => {
      for (const scope of subscriptions) void this.realtime.publishPresence(scope);
    }, 0);
  }
}
