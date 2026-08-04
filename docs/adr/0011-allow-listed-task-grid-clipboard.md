# ADR 0011: Allow-listed task grid clipboard

- Status: Accepted
- Date: 2026-07-29

## Context

Spreadsheet-style copy and paste is useful in a task grid, but accepting arbitrary tabular data can mutate tenant-owned identifiers, bypass field validation, or generate an unbounded burst of API requests. Global clipboard handlers can also break normal copy and paste inside text inputs and editors.

## Decision

The task grid owns clipboard shortcuts only while focus is within the grid and outside a text-editing control. Checkbox and radio inputs remain grid controls; text inputs, text areas, selects, and content-editable elements keep their native behavior.

Copied tasks use a versioned-by-structure TSV contract with one exact header:

`title, status, priority, assigneeId, storyPoints, estimatedHours, dueDate`

No organization, workspace, project, task ID, version, order, or audit field is accepted from the clipboard.

The parser validates the whole payload before mutation:

- exact header and column count;
- at least one and at most 500 rows;
- required non-empty title;
- allow-listed status and priority;
- bounded non-negative numeric values;
- strict calendar dates in `YYYY-MM-DD`.

The UI then validates that every non-empty assignee is visible in the current workspace and checks `tasks.update`. One pasted row may be repeated over all selected targets. Multiple rows map in visible sorted order and cannot exceed the available targets.

Updates run sequentially through the existing typed task operation. A task pasted into `done` receives 100 percent progress. Clipboard access failures and validation failures are shown without beginning the update sequence.

## Consequences

- Clipboard data cannot change tenant scope, identity, ordering, or concurrency fields.
- Normal editing controls retain native clipboard and keyboard behavior.
- Large pastes are bounded and do not create an unbounded parallel request burst.
- The format is intentionally stricter than arbitrary Excel input; users first copy a row from CalmBoard to obtain the supported header.
- The operation is validated as a batch but each task remains an individual authorized API update.
