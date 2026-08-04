# ADR 0006: Build workspace exports as durable background jobs

- Status: Accepted
- Date: 2026-07-29

## Context

The API previously queried every workspace data set, assembled a JSON archive, and returned the entire result inside one HTTP request. Large workspaces could exhaust request time or memory, and a process interruption lost the export without a retryable receipt.

## Decision

`POST /workspaces/export` now records a tenant-scoped `export_jobs` row and returns its public status. The request requires an `Idempotency-Key`; replaying the same key returns the same job.

The worker claims due jobs with `FOR UPDATE SKIP LOCKED` and a UUID claim token. It reads the workspace from one `REPEATABLE READ READ ONLY` transaction, excludes soft-deleted records, creates a versioned JSON archive, and uploads it to a deterministic S3 object key. It then persists the file name, size, SHA-256 checksum, completion time, and expiry.

Failures return to `pending` with exponential backoff and become `dead` after the configured attempt limit. A stale processing claim can be recovered, while claim-token checks prevent an old worker from completing a claim that another worker recovered.

Clients poll `GET /workspaces/export/:jobId` and request a short-lived signed download URL only after completion. Every status and download read is scoped to the requesting user, organization, and workspace.

## Consequences

- API requests no longer build or stream large workspace archives.
- Export intent and progress survive API and worker restarts.
- Retried requests and worker executions do not create duplicate jobs or object paths.
- Archives have a consistent database snapshot and exclude soft-deleted entities.
- Completed objects expire logically after the configured retention period.
- Physical deletion of expired export objects remains an operations/retention follow-up.
