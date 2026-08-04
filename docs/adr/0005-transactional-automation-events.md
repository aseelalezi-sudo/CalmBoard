# ADR 0005: Execute automations from transactional task events

- Status: Accepted
- Date: 2026-07-29

## Context

Task requests executed automation rules synchronously after the task transaction committed. Provider or process failure could therefore lose an automation, while retrying the request could repeat comments or notifications. Evaluating a delayed event against the latest task state could also produce a different result from the state that originally triggered it.

## Decision

Task and comment repositories write an `automation_events` row in the same transaction as the triggering mutation. Each event contains tenant scope, task and version, trigger, actor, previous values, an immutable current-state snapshot, a parent event, loop depth, and a deterministic deduplication key.

The worker claims events with `FOR UPDATE SKIP LOCKED` and a UUID claim token. Each matching rule executes in its own PostgreSQL transaction together with its task update, comment, notification, and `automation_runs` record. A unique `(event_id, automation_id)` key makes successful rule execution replay-safe.

Rule-generated mutations emit child events. Child depth is limited to five and is validated against the parent by PostgreSQL. Failures return to `pending` with exponential backoff and become `dead` after the configured attempt limit.

Daily rules use a separate BullMQ cron scheduler. It emits at most one `schedule_daily` event per UTC date and task through a deterministic key.

## Consequences

- API task requests no longer wait for automation execution.
- Committed task changes cannot lose their automation intent.
- Conditions use the event-time snapshot while actions lock and update the current task.
- Database effects and the successful run receipt commit atomically.
- Reprocessing skips successful or skipped rule receipts.
- Operators can inspect pending, processing, completed, skipped, and dead events.
- The maximum cascade depth is five; deeper rule-generated events are deliberately suppressed.
