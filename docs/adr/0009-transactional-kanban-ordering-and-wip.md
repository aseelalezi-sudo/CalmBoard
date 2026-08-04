# ADR 0009: Transactional Kanban ordering and persisted WIP limits

- Status: Accepted
- Date: 2026-07-29

## Context

Kanban cards were previously moved with native browser drag events and ordinary task updates. That approach did not support touch or keyboard access consistently, did not persist a complete column order, and could allow concurrent moves to overwrite one another. WIP limits existed only as local UI state, so they were neither shared nor authoritative.

The board can also show a filtered subset of tasks. A visible index in that subset is not a valid position in the complete persisted column.

## Decision

The web board uses `dnd-kit` with pointer, delayed touch, and keyboard sensors. Cards expose a dedicated drag handle, and the server remains the authority for every completed move. Reordering is disabled while any task filter is active so a subset index can never be stored as a full-column index.

Nest exposes `PATCH /tasks/:id/move` with an explicit target status, target index, and expected task version. The database repository performs the move in one transaction:

- lock the project first to serialize all moves that can affect its columns;
- lock and validate the moving task and its optimistic version;
- load only active top-level board tasks in deterministic order;
- remove and insert the moving task, then normalize affected column orders;
- validate the target WIP limit before commit;
- increment versions for every task whose persisted position changed;
- emit the existing status-change automation event when applicable.

WIP limits are stored in the normalized `project_wip_limits` table, keyed by project and task status. The table carries direct organization and workspace scope, validates the owning project scope with a PostgreSQL trigger, and enforces tenant RLS. The project API owns reading and updating these limits.

The UI applies an optimistic move for responsiveness, then reloads authoritative data. It rolls back and reports a conflict if the transaction rejects the version or WIP constraint.

## Consequences

- Card order and status are committed together or not at all.
- Concurrent moves in one project cannot silently interleave.
- WIP limits are shared, durable, tenant-isolated, and enforced even outside the web UI.
- Touch and keyboard users receive the same persisted operation as pointer users.
- Reordering is intentionally unavailable on a filtered board until an anchor-based protocol is introduced.
- Updating one card may advance versions of neighboring cards because their persisted order changed; clients therefore refresh the board after a move.
