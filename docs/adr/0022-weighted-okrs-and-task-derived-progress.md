# ADR 0022: Weighted OKRs and task-derived progress

- Status: Accepted
- Date: 2026-07-30

## Context

Goals were stored as flat records with an unconstrained type and parent identifier. Progress and check-in history were accepted from the client, key results could not be related to tasks, and objective progress had no reproducible calculation. This made goal ownership, hierarchy, auditability, and status inconsistent across the API and web application.

## Decision

Goals form a two-level hierarchy: an objective is the root and a key result belongs to an objective. New key results require a valid same-tenant objective parent. Objectives aggregate the progress of their key results using each key result's positive contribution weight.

Key-result progress uses one of three explicit modes:

- `manual` records trusted relational check-ins.
- `measurement` derives progress from start, current, and target values.
- `tasks` derives progress from linked tasks using each task link's positive contribution weight.

Objectives use the `children` mode. All calculated progress is clamped to zero through one hundred. Status is derived from progress and, when a period is defined, from the expected pace between the period boundaries.

Check-ins are append-only relational records whose actor is taken from the authenticated repository context. The request cannot choose the author. Task links are relational, tenant-scoped, and allowed only for key results. Database triggers refresh task-derived key results when linked task progress changes and refresh parent objectives when child progress, weight, parent, or deletion state changes. Repository mutations also request an explicit refresh so returned API data is immediately authoritative.

The migration preserves existing goal rows, normalizes invalid values, converts valid legacy JSON check-ins into relational records, and retains a read fallback for historical check-ins that cannot be converted safely.

## Consequences

- Objective progress is deterministic and reflects the weighted contribution of its key results.
- Key results can track a measured outcome, trusted manual updates, or delivery progress from real tasks.
- Client-supplied progress and author identifiers are not trusted as business state.
- Task updates propagate to linked key results and their objectives without requiring the web application to recalculate persisted values.
- The two-level model intentionally excludes nested objectives and nested key results.
- Legacy JSON check-in storage remains temporarily available for compatibility and can be removed after all production data has been verified as migrated.
