"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiServiceUrl } from "@/lib/client-api";
import { getCurrentSession } from "@/features/workspace/api";

export type RealtimePresence = {
  id: string;
  name: string;
  avatarUrl?: string;
};

type RealtimeStatus = "disconnected" | "connecting" | "connected" | "denied";

type RealtimeEvent = {
  id: string;
  schemaVersion: 1;
  version: number;
  type: "workspace.changed";
  scope: {
    organizationId: string;
    workspaceId?: string;
    projectId?: string;
    taskId?: string;
  };
};

type Scope = {
  organizationId: string;
  workspaceId: string;
  projectId?: string;
};

type JoinResult = { ok: true; version: number; presence: RealtimePresence[] } | { ok: false; error: string };

type UseRealtimeInput = {
  enabled: boolean;
  scope?: Scope;
  onInvalidate: () => void | Promise<void>;
};

function realtimeOrigin() {
  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL ?? apiServiceUrl("/");
  return new URL(realtimeUrl).origin;
}

export function useRealtime({ enabled, scope, onInvalidate }: UseRealtimeInput) {
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const [presence, setPresence] = useState<RealtimePresence[]>([]);
  const invalidateRef = useRef(onInvalidate);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastVersion = useRef(0);
  const presenceVersion = useRef(0);
  const organizationId = scope?.organizationId;
  const workspaceId = scope?.workspaceId;
  const projectId = scope?.projectId;

  useEffect(() => {
    invalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!enabled || !organizationId || !workspaceId) {
      setStatus("disconnected");
      setPresence([]);
      return;
    }

    let disposed = false;
    let refreshingSession = false;
    lastVersion.current = 0;
    presenceVersion.current = 0;
    const joinedScope: Scope = {
      organizationId,
      workspaceId,
      ...(projectId ? { projectId } : {}),
    };
    const socket: Socket = io(`${realtimeOrigin()}/realtime`, {
      withCredentials: true,
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
    });
    setStatus("connecting");

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        void Promise.resolve(invalidateRef.current()).catch(() => undefined);
      }, 250);
    };

    const join = () => {
      socket.emit("realtime:join", joinedScope, (result: JoinResult) => {
        if (disposed) return;
        if (!result?.ok) {
          setStatus("denied");
          setPresence([]);
          return;
        }
        const reconnected = lastVersion.current > 0;
        if (result.version > lastVersion.current) lastVersion.current = result.version;
        setPresence(result.presence ?? []);
        setStatus("connected");
        if (reconnected) scheduleRefresh();
      });
    };

    socket.on("connect", join);
    socket.on("disconnect", () => {
      if (!disposed) setStatus("connecting");
    });
    socket.on("connect_error", (error: Error) => {
      if (disposed) return;
      setStatus("connecting");

      const isAuthError = error.message.includes("Authentication");
      if (isAuthError && !refreshingSession) {
        refreshingSession = true;
        void getCurrentSession()
          .catch(() => {
            if (!disposed) {
              setStatus("disconnected");
              socket.disconnect();
            }
          })
          .finally(() => {
            refreshingSession = false;
          });
      }
    });
    socket.on("realtime:event", (event: RealtimeEvent) => {
      if (
        event?.schemaVersion !== 1 ||
        event.scope.organizationId !== organizationId ||
        event.scope.workspaceId !== workspaceId ||
        event.version <= lastVersion.current
      ) {
        return;
      }
      lastVersion.current = event.version;
      scheduleRefresh();
    });
    socket.on(
      "realtime:presence",
      (snapshot: { schemaVersion: 1; version: number; workspaceId: string; users: RealtimePresence[] }) => {
        if (
          snapshot?.schemaVersion === 1 &&
          snapshot.workspaceId === workspaceId &&
          snapshot.version >= presenceVersion.current
        ) {
          presenceVersion.current = snapshot.version;
          setPresence(snapshot.users ?? []);
        }
      },
    );

    return () => {
      disposed = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      socket.emit("realtime:leave", joinedScope);
      socket.disconnect();
    };
  }, [enabled, organizationId, workspaceId, projectId]);

  return { status, presence };
}
