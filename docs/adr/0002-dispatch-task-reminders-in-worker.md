# ADR 0002: Dispatch task reminders in the background worker

- Status: Accepted
- Date: 2026-07-28

## Context

Task reminders are persisted in PostgreSQL, but no process delivered them. Delivery must survive API restarts, remain tenant-scoped, and avoid duplicate effects when BullMQ retries a job.

## Decision

The BullMQ worker polls due reminders through a durable repeatable job. It locks a bounded batch with `FOR UPDATE SKIP LOCKED`, creates in-app notifications, and marks each reminder as sent in the same PostgreSQL transaction.

The reminder creator is the recipient when present. Legacy reminders without a creator fall back to active task assignees, followers, or the legacy task assignee/reporter. Every recipient is revalidated against an active membership in the reminder organization and workspace before insertion.

BullMQ retries the polling job five times with exponential backoff. Database errors roll back both the notification and reminder status; after a committed transaction the reminder is no longer eligible, making a repeated job safe.

## Consequences

- API restarts do not lose scheduled reminders because Redis owns the schedule and PostgreSQL owns reminder state.
- Parallel workers do not process the same reminder concurrently.
- Reminder delivery cannot cross organization or workspace membership boundaries.
- Email delivery remains a separate queue migration because an external email side effect needs its own durable outbox/idempotency contract.
