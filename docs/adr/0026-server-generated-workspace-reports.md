# ADR 0026: Server-generated workspace PDF and Excel reports

- Status: Accepted
- Date: 2026-07-31

## Context

Workspace export already used a durable, tenant-scoped worker job, but it produced only the full JSON backup. The settings screen also exposed browser printing, which could not provide a consistent downloadable report and depended on the currently rendered client state.

## Decision

Workspace export jobs accept an allow-listed immutable format: `json`, `pdf`, or `xlsx`. Reusing an idempotency key with a different format is rejected. The API derives the requester from the authenticated session, requires `data.export`, and stores only a validated tenant scope and format.

The existing asynchronous worker builds one consistent archive from persisted workspace records and then renders the requested output:

- JSON remains the complete machine-readable backup.
- PDF is an A4 landscape report with workspace metrics, projects, and tasks. It embeds the OFL-licensed Noto Sans Arabic font so Arabic data is generated on the server without relying on browser fonts.
- XLSX is a right-to-left multi-sheet workbook containing a summary plus projects, tasks, goals, and time logs.

All formats use the same durable claim, retry, dead-letter, checksum, object-storage, expiry, and signed-download flow. The output extension and content type are determined by the persisted format, not by client-provided file metadata.

## Consequences

- PDF and Excel downloads are reproducible server artifacts and do not depend on the visible browser state.
- Existing JSON backup behavior remains available and distinct from human-readable reports.
- Report generation consumes worker memory proportional to the exported workspace; very large streaming exports may require a future chunked implementation.
- Adding another format requires updating the database allow list, API validation, worker renderer, content type mapping, and tests.
- Deployments must package `apps/worker/assets/NotoSansArabic.ttf` and its OFL license with the worker runtime.
