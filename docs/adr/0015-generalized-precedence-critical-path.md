# ADR 0015: Generalized-precedence critical path

- Status: Accepted
- Date: 2026-07-29

## Context

Critical-path analysis requires task durations and the complete directed dependency graph. The database already stored four dependency types and lag minutes, but task responses exposed only compatibility serials. Inferring criticality from priority or the mere presence of a dependency would be incorrect.

## Decision

Task hydration reads active dependency links from `task_dependencies` and returns:

- the blocking task identity and serial;
- `finish_to_start`, `start_to_start`, `finish_to_finish`, or `start_to_finish`;
- lag or lead in minutes.

The compatibility `dependencies` serial array is derived from these relational rows.

The web uses a pure generalized-precedence CPM engine. Durations are the real minute difference between stored start and due timestamps; a task with only one endpoint has zero duration. Every dependency becomes a start-time constraint:

- FS: blocker duration plus lag;
- SS: lag;
- FF: blocker duration plus lag minus dependent duration;
- SF: lag minus dependent duration.

A topological forward pass computes earliest starts and finishes. A reverse pass from the project finish computes latest starts and finishes. Tasks with zero total float are critical, and only tight links between critical tasks are highlighted.

The engine fails closed when the graph is cyclic or when a dependency endpoint cannot be rendered. It does not publish a partial critical path that could be mistaken for the project result.

## Consequences

- Criticality is derived from durations, precedence constraints, and float rather than task priority.
- All four stored dependency types and lag/lead values affect the result.
- Gantt can show project duration and task float with traceable calculations.
- Relational dependency data is now part of the task API contract.
- Unscheduled or missing dependency endpoints must be corrected before CPM is available.
- Milestone management, baselines, and schedule-conflict detection remain separate features.
