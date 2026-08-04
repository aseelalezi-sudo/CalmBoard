# ADR 0013: Persisted calendar drag and duration resize

- Status: Accepted
- Date: 2026-07-29

## Context

The multi-view task calendar displayed real task date ranges but could not move or resize them. A calendar interaction must preserve task duration and times, respect authorization, work across input methods, and persist through the same task service used by the other views.

## Decision

Every visible calendar day is a `dnd-kit` drop target. Each task occurrence provides a move handle, and its final occurrence also provides a duration-resize handle. Pointer, touch, and keyboard sensors share the same drop behavior.

Moving from a visible occurrence to another day shifts both `startDate` and `dueDate` by the calendar-day difference, preserving the complete span and each timestamp's time component. Resizing changes only the end date. Extending a due-only task promotes its original due date to `startDate`; an end date before the effective start is rejected.

Calendar-day differences are calculated from UTC serials built from local year, month, and day components. This measures calendar boundaries without allowing daylight-saving transitions to turn a one-day move into a zero- or two-day move. ISO timestamps continue through the existing typed task update operation.

Drag handles are hidden without `tasks.update`. The update operation returns an explicit success result: it retains the existing optimistic update, reverts and reports an error when persistence fails, and permits the calendar to show success only after confirmed storage.

## Consequences

- Day, week, and month views use one move and resize implementation.
- Multi-day moves preserve their duration and time components.
- Invalid backward resizing cannot create an inverted task range.
- Mouse, touch, and keyboard users receive the same persisted operation.
- Column sizing and ordering in the task grid still require saved-view persistence before the broader “every drag/resize persists” criterion can close.
