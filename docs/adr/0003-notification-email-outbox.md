# ADR 0003: Deliver tenant notification email through a durable outbox

- Status: Accepted
- Date: 2026-07-28

## Context

The API delivered notification email directly through Resend. A slow or unavailable provider extended the request, and an API restart could lose the delivery after the in-app notification had already committed. Blind retries could also send the same email more than once.

Authentication email is a separate concern because it contains raw one-time tokens and must not be placed in an unencrypted notification outbox.

## Decision

Tenant notification email is written to `notification_email_outbox`. When the API request has a tenant database transaction, the in-app notification and its email outbox row commit together.

The worker claims bounded batches with `FOR UPDATE SKIP LOCKED`. A UUID claim token identifies the current owner independently of timestamp precision. Before delivery, the worker revalidates active organization/workspace membership and the current email preference.

Failures return to `pending` with exponential backoff, and exhausted items move to `dead`. Successful and terminal rows cannot be reopened by database trigger. Row-level security and database triggers enforce the tenant, recipient, workspace, and linked-notification scope.

Every Resend request uses the stable outbox ID in the provider `Idempotency-Key` header. This protects the external side effect if the provider accepts a request but the worker stops before persisting `sent`.

## Consequences

- API requests no longer wait for notification email delivery.
- API restarts cannot lose committed notification email work.
- Parallel workers cannot own the same current claim.
- Provider and database retries do not duplicate an email within the provider idempotency window.
- Operators can inspect `pending`, `processing`, `sent`, `skipped`, and `dead` states.
- Authentication email uses the separate encrypted outbox defined by ADR 0004.
