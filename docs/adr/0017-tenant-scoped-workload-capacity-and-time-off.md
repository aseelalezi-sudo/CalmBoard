# ADR 0017: Tenant-scoped workload capacity and time off

- Status: Accepted
- Date: 2026-07-29

## Context

The workload view used one hard-coded 40-hour capacity, counted tasks without a weekly schedule boundary, and selected a rebalance target using a hard-coded 25-hour threshold. It could not represent part-time schedules, vacations, sick leave, or workspace holidays, so its utilization percentages were not auditable.

## Decision

Workspace member capacity is stored as weekly minutes plus a seven-bit workday mask. One capacity row exists for each organization, workspace, and user tuple. Missing rows intentionally use a documented 2,400-minute Monday-to-Friday default.

Time off is stored as a dated tenant-scoped record with:

- vacation, sick, personal, or public-holiday kind;
- requested, approved, or rejected lifecycle status;
- an inclusive start and end calendar date;
- optional minutes per day for partial-day absence;
- an optional note and creating actor.

Public holidays target the workspace and therefore have no user. Other kinds require a user with an active membership in the matching organization and workspace. Database triggers enforce workspace and membership scope, and forced row-level security protects both workload tables. Management mutations require `members.manage`.

The weekly calculation is a pure web-domain function. It includes only open tasks whose stored date range intersects the selected ISO week. Unscheduled tasks are reported separately. A shared task's estimated minutes are divided across its distinct assignees. Approved member time off and workspace holidays reduce capacity only on configured working days, and overlapping entries cannot reduce more than one day's capacity.

The view displays configured capacity, effective capacity, allocated work, time-off days, and utilization for each active workspace member. Its one-task rebalance action chooses the member with the lowest effective utilization who still has spare capacity.

## Consequences

- Workload percentages are derived from persisted capacity and dated availability.
- Part-time members, non-standard workweeks, partial days, vacations, and workspace holidays are representable.
- Tenant scope is enforced below the API as well as by authorization guards.
- Tasks without dates no longer create an invented weekly load.
- The simple one-task rebalance remains deterministic and explainable; a constraint-based assignment optimizer remains a separate feature.
