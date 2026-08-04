# ADR 0007: Unify durable dead letters with BullMQ operations

- Status: Accepted
- Date: 2026-07-29

## Context

BullMQ retains exhausted queue jobs in Redis, while notification email, authentication email, automation, and workspace export processors persist their own terminal `dead` state in PostgreSQL. The administration screen previously displayed an in-memory list of fabricated jobs and changed failed entries directly to completed.

Operators need one truthful view without weakening tenant isolation or allowing arbitrary terminal-state changes.

## Decision

The protected Nest endpoint `/admin/queues` combines two operational sources:

- retained BullMQ jobs and counts from the configured Redis queue;
- durable PostgreSQL rows exposed by `list_dead_letters()` for the four processors that own a `dead` state.

The PostgreSQL listing function is `SECURITY DEFINER`, but returns data only when the request transaction's trusted `app.actor_id` belongs to a platform administrator. Tenant application repositories cannot list the global dead-letter set.

Direct updates from `dead` back to `pending` remain rejected by table triggers. `retry_dead_letter()` is the only supported reopening path. It validates the same trusted platform-admin context, sets a transaction-local retry marker, preserves the attempts ledger, increases the retry budget, clears the previous claim, and makes the item available immediately. Existing idempotency identities remain unchanged.

BullMQ retries use the queue's native failed-job transition. Manual attachment cleanup is enqueued as a real BullMQ job with the production retry policy. If Redis is unavailable, the dashboard still returns durable PostgreSQL dead letters and reports Redis as unavailable.

The Next.js in-memory queue route is removed. Browser actions call the Nest API directly, so authentication, platform-admin authorization, CSRF protection, rate limiting, and unified error handling apply.

## Consequences

- The administration screen represents retained operational state rather than sample data.
- Platform administrators can retry one item or all failed items without bypassing database invariants.
- Retrying preserves provider idempotency keys, event receipts, and deterministic export object paths.
- A Redis outage does not hide durable dead letters.
- The dashboard is an operational view of retained jobs, not a historical analytics system.
