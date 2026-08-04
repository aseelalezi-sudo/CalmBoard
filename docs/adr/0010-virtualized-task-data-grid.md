# ADR 0010: Virtualized task data grid

- Status: Accepted
- Date: 2026-07-29

## Context

The advanced task grid was a hand-built flex layout that described itself as a TanStack grid. It sorted a copied array locally, rendered every task row, and implemented visibility with a separate list of hidden column names. It had no shared column model for sizing, ordering, or pinning and could not scale its DOM to large task sets.

## Decision

The advanced grid uses `@tanstack/react-table` as its controlled table state engine and `@tanstack/react-virtual` as its row windowing engine.

TanStack Table owns:

- the sorted and selected row models;
- stable task IDs;
- column visibility and order;
- logical left pinning for RTL and LTR;
- live column sizing and resize handlers.

The task collection supplied by `ViewCtx` remains the only data source. Editable cells invoke the existing typed task operations, and bulk actions derive their task IDs from the selected TanStack row model.

The virtualizer renders only the visible window plus a bounded overscan. It preserves a full scroll extent using the measured total size and absolutely positions rendered rows. Headers remain sticky, while pinned cells use the offsets calculated by the table model.

The selection column is fixed at the beginning of the order. A pure normalization helper restores missing columns and removes stale or duplicate identifiers, allowing future persistence without trusting malformed state.

## Consequences

- Sorting, resizing, visibility, ordering, and pinning use one consistent column model.
- DOM row count is bounded by the viewport rather than total task count.
- RTL and LTR share the same logical pinning implementation.
- Existing task update and authorization paths remain unchanged.
- The overall 100,000-task closure criterion remains open until every relevant view is virtualized and measured together.
