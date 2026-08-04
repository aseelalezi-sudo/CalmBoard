# ADR 0014: Real-date and dependency Gantt

- Status: Accepted
- Date: 2026-07-29

## Context

The previous Timeline positioned a maximum of twelve tasks from their row indexes and sized bars from estimated hours. It also presented a “critical path” toggle based on priority or the presence of any dependency. Those values did not represent the stored schedule or a critical-path calculation.

## Decision

The Timeline route now renders a dedicated Gantt component backed by a pure model:

- the visible range starts at the earliest valid task start and ends at the latest valid task end;
- a missing start or end uses the one stored endpoint, producing a truthful one-day task;
- an inverted or invalid range is excluded and reported rather than normalized silently;
- bar offsets and inclusive durations use calendar-day differences;
- day, week, and month headers group the same continuous daily scale, with real week boundaries and real calendar months;
- dependency serials are resolved against the loaded task collection and rendered as directed arrows only when both endpoints have valid schedules.

The model reports unscheduled tasks, invalid ranges, missing dependency serials, and dependencies whose blocking task cannot be rendered. The UI exposes those counts instead of fabricating bars or links.

The legacy approximation and its false critical-path control are removed. Critical-path analysis remains a separate requirement and is not inferred from priority, progress, or dependency presence.

## Consequences

- Every displayed bar is traceable to stored task dates.
- Every displayed arrow is traceable to a stored dependency.
- A one-date task remains visible without an invented estimate.
- Invalid and incomplete schedule data is visible as an explicit quality signal.
- Long schedules remain horizontally scrollable and preserve proportional day widths.
- Actual critical-path calculation, milestones, and baselines remain future decisions.
