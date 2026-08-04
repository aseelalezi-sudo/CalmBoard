# ADR 0027: Timezone-aware scheduled report email

- Status: Accepted
- Date: 2026-08-01

## Context

PDF and Excel workspace reports were available only on demand. The product requirements also call for recurring reports delivered by email. Reimplementing report generation or calling the API from a timer would have bypassed the existing durable export, retry, object-storage, and authorization controls.

## Decision

Report schedules are tenant-scoped, owner-scoped, and protected by `data.export`. A schedule selects PDF or XLSX, daily, weekly, or monthly cadence, an IANA time zone, local time, active workspace recipients, and enabled state. Updates use optimistic versions. PostgreSQL validates tenant ownership, active membership, recurrence fields, time zones, recipient scope, and forced row-level security.

PostgreSQL calculates the next occurrence with `next_report_run`, including time-zone conversion. A bounded BullMQ poller claims due schedules with `FOR UPDATE SKIP LOCKED`, inserts one export job using a deterministic occurrence idempotency key, and advances the schedule in the same transaction. Missed intervals are collapsed to the next future occurrence instead of sending a backlog after downtime.

The normal workspace export worker generates the report and, in the same completion transaction, creates an in-app notification and one notification-email outbox item per still-active recipient. The outbox references the stored artifact metadata. The email worker revalidates membership and email preferences, downloads the object from storage, and sends it as an attachment through the existing idempotent provider transport. Attachments are bounded to 20 MB.

## Consequences

- Scheduled and on-demand reports share the same rendering, checksums, storage, retention, retry, and dead-letter behavior.
- Concurrent workers cannot create duplicate reports or emails for one occurrence.
- Schedule owners can create, pause, resume, and delete schedules from workspace settings.
- Recipients must remain active workspace members and may opt out through notification preferences.
- Reports above the email attachment limit fail through the durable retry and dead-letter path; a future signed-link delivery mode can cover larger artifacts.
