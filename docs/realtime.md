# Realtime operations

## Transport

- Namespace: `/realtime`
- Authentication: the HTTP-only `calmboard_access` session cookie
- Browser origin: `APP_URL`
- Distributed adapter and event versions: `REDIS_URL`

Production requires Redis. With no Redis in development, the API keeps realtime delivery local to one process and uses a local monotonic fallback.

## Client protocol

The client sends `realtime:join` with identifiers, never a raw room name:

```json
{
  "organizationId": "uuid",
  "workspaceId": "uuid",
  "projectId": "uuid",
  "taskId": "uuid"
}
```

`workspaceId`, `projectId`, and `taskId` are optional in that order. If a task is supplied without a project, the server resolves its project from the tenant-scoped task row. The server verifies the complete resource chain before joining.

Successful joins return the normalized scope, current event version, and workspace presence. Denied joins return a generic error without tenant details.

`realtime:event` is an invalidation envelope. It deliberately excludes mutation bodies and entity content:

```json
{
  "id": "uuid",
  "schemaVersion": 1,
  "version": 42,
  "type": "workspace.changed",
  "action": "updated",
  "resource": "tasks",
  "scope": {
    "organizationId": "uuid",
    "workspaceId": "uuid",
    "projectId": "uuid",
    "taskId": "uuid"
  },
  "occurredAt": "2026-07-29T00:00:00.000Z"
}
```

`realtime:presence` is also versioned. Its user list contains only public identity fields and is deduplicated across tabs.

## Recovery

The browser reconnects with a 500 ms initial delay, a 10 second maximum delay, and jitter. On a failed handshake it attempts the normal HTTP refresh-token flow, reconnects, and rejoins the last authorized scope. After a successful rejoin it reloads the workspace through the API. Events arriving in a burst are coalesced into one refresh.

## Security checks

- Never accept user-supplied room names.
- Never put request bodies or entity content in an event.
- Keep the organization identifier in every room.
- Publish HTTP invalidations only after the tenant transaction resolves successfully.
- Use `fetchSockets()` through the Redis adapter for multi-process presence.
- Treat HTTP reads as authoritative after reconnection.

The integration test `apps/api/integration/realtime-isolation.test.ts` starts a real Nest/Socket.IO server, connects two valid sessions from different organizations, rejects a cross-tenant join, and proves that an event delivered to one organization is not received by the other.
