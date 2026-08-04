# ADR 0012: Multi-view task calendar

- Status: Accepted
- Date: 2026-07-29

## Context

The task calendar rendered only the current month and could not navigate to another period. Its date grouping considered only due dates in that month, so it could not represent a task spanning a start and due date or provide day and week workflows.

## Decision

The calendar is an independent task feature with three modes: day, week, and month. All modes consume the same `ViewCtx.tasks` collection as the board, list, and data grid.

Date-range calculation is kept in pure helpers:

- day view returns the selected calendar day;
- week view returns seven days from the locale-specific week boundary;
- month view returns a stable 42-day grid from the week containing the first day;
- navigation shifts by one day, seven days, or one calendar month;
- a task occurs on every day in the inclusive range between its start and due dates.

Arabic weeks start on Saturday and English weeks start on Sunday. Calendar-day keys use local year, month, and day components so rendering is consistent with the user's visible calendar rather than a UTC string boundary.

Creating a task from a date sets a noon due date for that local day, avoiding a midnight value that could appear on an adjacent day after timezone conversion. Opening and creating tasks continue to use the existing authorized task operations.

## Consequences

- Day, week, and month views share one task source and one range model.
- Multi-day tasks remain visible throughout their real span.
- Month layout height is stable across all months.
- Invalid dates are ignored rather than assigned synthetic positions.
- Dragging and duration resizing remain a separate decision and are not considered complete by this ADR.
