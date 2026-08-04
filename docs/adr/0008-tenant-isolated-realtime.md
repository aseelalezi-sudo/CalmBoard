# ADR 0008: Tenant-isolated realtime invalidation and presence

- Status: Accepted
- Date: 2026-07-29

## Context

The web application previously showed every workspace member as online and had no server-driven updates. A realtime channel must not trust tenant identifiers supplied by a browser, expose mutation payloads, or deliver events from one organization to another.

The API may also run more than one process, so process-local Socket.IO rooms and counters are insufficient for production delivery.

## Decision

Nest owns a Socket.IO gateway under the `/realtime` namespace. The gateway authenticates the existing `calmboard_access` cookie and validates its backing session before accepting subscriptions.

Every requested scope is authorized against the database. The server verifies active organization/workspace membership and confirms that referenced workspaces, projects, and tasks belong to the requested tenant chain. Room names always contain the organization identifier:

- `organization:{organizationId}`
- `workspace:{organizationId}:{workspaceId}`
- `project:{organizationId}:{workspaceId}:{projectId}`
- `task:{organizationId}:{workspaceId}:{taskId}`

Clients cannot provide room names directly. Authorization failures return a generic denial and never join a room.

HTTP mutations publish only after the tenant database transaction commits. The event contains an opaque identifier, schema version, monotonically increasing Redis-backed workspace version, action, resource name, tenant scope, and timestamp. It contains no request body or entity content. The web client treats the event as an invalidation signal and reloads the authorized workspace data.

Socket.IO uses the Redis adapter when `REDIS_URL` is configured, so room broadcasts and `fetchSockets()` presence snapshots work across API processes. Production startup fails if Redis is not configured. Development can fall back to the local process if Redis is unavailable.

Presence is derived from authenticated sockets currently joined to the workspace room. Multiple tabs for one user are deduplicated. Presence snapshots are versioned events and replace the former UI count based on all directory users.

The web client reconnects indefinitely with exponential bounded backoff and jitter. It refreshes an expired HTTP session before reconnecting, rejoins the authorized scope, rejects stale event versions, and refreshes data after reconnection.

## Consequences

- An organization identifier is part of every room identity, preventing same-ID room collisions across tenants.
- Realtime events never become a second data API and cannot leak task or document content.
- Mutations are not announced before their database commit is visible.
- Presence represents live authenticated connections rather than membership.
- Redis provides cross-process delivery and monotonic versions; local fallback is development-only.
- Reconnect recovery uses authoritative HTTP reads instead of replaying potentially stale payloads.
