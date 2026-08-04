# ADR 0019: Bounded keyset task collections and anchored board moves

- Status: Accepted
- Date: 2026-07-30

## Context

The workspace shell loaded every task in the active project before rendering any task view. Table virtualization bounded the DOM but did not bound the database query, API payload, or browser memory. Kanban rendered every task in each status, and moving one card loaded and rewrote all rows in the affected columns. Those paths could not provide a credible 100,000-task project target.

Offset pagination was not selected because concurrent inserts and updates can move rows between offsets and because large offsets require PostgreSQL to walk discarded rows. A board move based only on an absolute array index also cannot be correct when the browser has loaded only part of a column.

## Decision

Table and Board use server-side keyset pagination. A versioned opaque cursor contains the selected sort field, direction, last sort value, and task id. PostgreSQL applies tenant and project scope, filters, stable ordering, and the cursor before limiting the result. The API limits every page to at most 100 records and returns the matching total and next cursor.

Table loads 100 tasks at a time. Board maintains an independent cursor and total for each visible status and loads 50 cards at a time. Other views retain their existing full-collection contract until they receive view-specific bounded query models.

Board mutations send the ids immediately before and after the requested position. The repository validates both anchors inside the tenant, project, status, and top-level task scope, calculates a fractional order between them, enforces optimistic versioning and WIP limits, and updates only the moved task. The previous `targetIndex` path remains available for older clients.

Page hydration may query related records only for task ids in the current page. Composite indexes support active project pages by creation date and title and Board pages by status and order. An integration fixture inserts 100,000 tasks and verifies two non-overlapping Table pages and one bounded Board page under a five-second query budget.

## Consequences

- Table and Board no longer transfer or retain the complete 100,000-task collection.
- Concurrent inserts do not create offset gaps or duplicates between cursor pages.
- A card can be positioned correctly using loaded neighbours without rewriting a whole column.
- Repeated moves can eventually exhaust floating-point space between two adjacent orders; a future maintenance job may rebalance a column when that rare conflict is reported.
- List, Calendar, Timeline, Workload, My Work, and Dashboard still need view-specific aggregation or pagination before they can claim the same collection-size target.
