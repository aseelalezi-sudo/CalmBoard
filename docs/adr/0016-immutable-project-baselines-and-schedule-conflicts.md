# ADR 0016: Immutable project baselines and schedule conflicts

- Status: Accepted
- Date: 2026-07-29

## Context

Schedule variance cannot be reconstructed reliably from mutable tasks or activity prose. Milestones also need stable domain identity instead of being inferred from a one-day bar. The existing relational dependency model already stores four precedence types and lag or lead minutes, so conflict detection should evaluate those constraints against actual task dates.

## Decision

Tasks store an explicit `is_milestone` flag. A database check and API validation require a milestone to have identical start and due timestamps.

Each project baseline consists of an immutable tenant-scoped header and immutable task snapshots. A snapshot records the source task identity, serial, title, schedule, milestone identity, and source version. Creation captures every active project task, including unscheduled tasks, in one transaction. Baseline creation is limited to 20 snapshots per project and requires `projects.update`; tenant triggers and forced row-level security protect both tables.

Baseline comparison is a pure web-domain calculation. It reports added, removed, and changed tasks, start and due variance in minutes, and milestone changes. Gantt overlays the selected baseline schedule behind the current schedule.

Schedule conflict detection evaluates current stored dates against every rendered relational dependency:

- finish-to-start compares the dependent start with the blocker finish plus lag;
- start-to-start compares both starts plus lag;
- finish-to-finish compares both finishes plus lag;
- start-to-finish compares the dependent finish with the blocker start plus lag.

The detector reports only violated constraints and their violation in minutes. Missing dates are not invented.

## Consequences

- Baseline history survives later task updates and deletions.
- Added, removed, and shifted work is measurable from persisted evidence.
- Milestones have consistent API, database, calendar, drawer, and Gantt behavior.
- Dependency conflicts use the same relational types and lag values as critical-path analysis.
- Baselines intentionally cannot be edited; users create a new snapshot when the approved plan changes.
- Resource capacity, leave calendars, and workload leveling remain separate scheduling concerns.
