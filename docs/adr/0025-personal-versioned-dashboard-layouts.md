# ADR 0025: Personal versioned dashboard layouts

- Status: Accepted
- Date: 2026-07-31

## Context

The dashboard had a fixed card order and width. Its custom-chart settings lived only in React state, so reloading lost them. Several metrics also displayed fixed demonstration trends instead of values derived from workspace data.

## Decision

Each active workspace member has one personal dashboard layout per workspace. The layout stores an ordered, bounded list of known widget identifiers, responsive widths, and allow-listed custom-chart settings. A missing row returns the default layout without creating data until the member customizes it.

Updates use optimistic versions. The API derives the layout owner from the authenticated session and accepts only organization and workspace scope from the client. Validation rejects unknown or duplicate widgets, unsupported widths, arbitrary settings, and stale versions.

PostgreSQL enforces workspace-to-organization membership, immutable tenant ownership, positive versions, and an array payload. Forced row-level security requires both the active tenant context and `user_id = app.actor_id`, so members cannot read or overwrite another member's layout even inside the same workspace.

The web dashboard supports pointer and keyboard reordering, responsive width cycling, hiding, restoring, and resetting widgets. Saves are serialized, and responses from a previously selected workspace are ignored. KPI, status, completion, goal, team, time, and activity widgets use loaded workspace records rather than fixed demonstration values. Custom charts persist their grouping, metric, and bar, rank, or donut presentation.

## Consequences

- Dashboard customization survives reloads and remains isolated per user and workspace.
- Concurrent or stale browser tabs fail with a version conflict instead of silently overwriting newer choices.
- Adding a widget type requires updating the shared allow lists, validation, defaults, and renderer.
- The JSON payload remains deliberately bounded; it is not a general-purpose component or query definition.
- Export remains permission-gated and uses the existing server-prepared workspace export.
