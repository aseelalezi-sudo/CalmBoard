# M4 Data Lifecycle & SaaS Operations — Execution Record

Audit date: 2026-08-09
Execution updated: 2026-08-11
Decision: **M4 TECHNICAL IMPLEMENTATION CLOSED; OPERATIONAL GATES CARRIED FORWARD**
Immutable migrations: `0001` through `0063_export_scope`

## Current execution status

- After the immutable `0062_data_lifecycle`, exactly one approved migration was created and applied to Development: `0063_export_scope`. No `0064` was created and no Backfill was executed.
- The pristine `0000..0063` migration chain and a copy of the Development database passed with 91 tables and 64 migrations. The journal, schema objects, enum/default/nullability, CHECKs, trigger, cleanup index, requester-aware RLS/FORCE RLS, policies, and drift verification passed.
- Durable account deletion and retained-principal anonymization, Organization scheduling/write-freeze/purge, trusted retry, non-PII receipts, canonical locator validation, and customer-facing lifecycle UI are implemented.
- Workspace portability now uses a versioned ZIP with explicit projections, a repeatable-read relational snapshot, attachment/preview binaries and hashes, safe integration metadata, requester ownership checks, expiry, and secret-exclusion regression coverage.
- Organization-wide portability now persists the authoritative Organization scope, requires Organization-level `data.export`, and isolates each requester. The Worker reads scope only from the database, takes one Organization-wide `REPEATABLE READ` relational snapshot, uses bounded UUID-keyset pages, stages restricted temporary files, streams the ZIP upload, and records deterministic attachment inclusion/unavailability with size and SHA-256. Workspace exports and Workspace-only scheduled reports remain unchanged.
- Expired completed and dead export artifacts are cleaned in bounded, idempotent, retry-safe Worker batches. Cleanup deletes and verifies only the deterministic generated export key. Because the immutable state trigger does not allow `completed -> expired`, successful physical cleanup is recorded by the durable `[artifact-cleaned]` marker while logical download expiry remains authoritative; a dedicated lifecycle state is future schema debt.
- Explicit safe projections and denylist tests exclude passwords, sessions, auth/refresh tokens, MFA/OAuth/integration credentials, invitation encrypted material, encryption keys, signed source URLs, and Worker/outbox payloads.
- Web, API, and Worker production images build locally from the final source. Their local digests are `efb9a0d42e1d7e7d2d56153c4212fc357851762c19a86f3a11db1f7b1450de79`, `3b8b3ed91cf84c7e79a633179d154317ff67fa83346793dea8e1ac35fbfb4988`, and `1433d97ed1d32a8239ffde9207a5d3dc0e4d7276cc72cef08bc4d6935eea45f1`. Final SPDX SBOM generation indexed 96 Web, 609 API, and 604 Worker packages. Grype scanned the retained SPDX files using image digest `sha256:ddf9e9f204049f3a4a0955ef70873cabab6a31432125ad4f20a490b54950a253` and reported zero vulnerabilities for all three final images. npm, which was unused at runtime and carried eight High/Critical findings from the Node base image, was removed from runner stages rather than suppressing findings.
- Destructive Organization purge remains disabled by default. It cannot be production-enabled until every required retention classification and provider-remediation requirement is approved.
- Real Stripe Test/Staging and encrypted backup/isolated-restore drills remain environment-gated. Browser visual QA is deferred to M5. No success is claimed for those independent operational gates.

The sections below retain the original pre-execution audit as historical evidence, followed by the approved and implemented `0062` contract. Statements in the historical audit describe the state before approval and are superseded by this status section.

# Historical pre-execution audit (superseded)

| Capability                       | Current implementation                                                                                              | Data affected                                  | Security requirements                                                 | Gap                                                                                                    | Migration required?                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Workspace export                 | Durable requester-scoped jobs, Worker processing, repeatable-read snapshot, private object storage, signed download | A limited workspace dataset                    | `data.export`, tenant transaction/RLS, requester ownership            | Incomplete inventory, JSON/PDF/XLSX rather than canonical ZIP, no binaries, no physical expiry cleanup | NO for export itself                   |
| User/account lifecycle           | Session management, MFA, OAuth identities and expiring auth tokens exist                                            | Login identity and personal security data      | Self-service only, recent re-authentication, CSRF, session revocation | No deletion request, grace period, cancellation, purge or anonymization lifecycle                      | **YES**                                |
| Organization/workspace lifecycle | Generic `deleted_at` columns exist                                                                                  | Tenant content and memberships                 | Owner-only, recent re-authentication, RLS, explicit confirmation      | Soft-delete timestamp cannot represent a durable destructive workflow                                  | **YES**                                |
| Relational/object cleanup        | Some entity soft deletes and attachment orphan/deleted-object cleanup                                               | Attachments and selected SQL entities          | Tenant-aware, retry-safe, idempotent                                  | No organization-wide batched purge or SQL/object completion coordination                               | **YES**                                |
| Documents/public links           | Documents are stored and exported only as rows                                                                      | Documents and sharing metadata                 | Tenant and sharing scope                                              | Must inventory versions/hierarchy/access/public-link revocation and objects                            | NO schema conclusion pending policy    |
| Comments/mentions                | Comments are exported; mention/reply coverage is incomplete                                                         | Discussion history                             | Preserve tenant scope; anonymize authors safely                       | Mentions and explicit thread/reply coverage are not proven in export                                   | NO                                     |
| Sprints/analytics                | Implemented in the product database                                                                                 | Sprint history, snapshots and events           | Tenant/project access                                                 | Absent from current export and its integration tests                                                   | NO                                     |
| Notifications/activity/audit     | Persisted; activity is partially exported                                                                           | Personal notifications and operational history | Separate customer-owned from security/legal records                   | No approved export/deletion/retention classification                                                   | NO; policy required                    |
| Integrations/OAuth/secrets       | Encrypted credentials and OAuth identities exist                                                                    | Provider metadata and secrets                  | Never export secrets; revoke/remove during deletion                   | Export needs explicit safe projections; purge/revocation orchestration absent                          | Lifecycle migration required           |
| Forms/reports                    | Definitions and export jobs exist                                                                                   | Forms, submissions, schedules, generated files | Tenant ownership and private objects                                  | Form responses and full scheduled-report inventory are absent from export                              | NO                                     |
| Billing/subscriptions            | Persisted plans, subscriptions, invoices, usage limits and webhook lifecycle                                        | Tenant entitlements and billing identifiers    | Verified webhook, backend source of truth, idempotency                | Real Stripe TEST/STAGING run and deletion/legal-retention policy not evidenced                         | NO schema for billing; policy required |
| Backup/restore                   | Encrypted PostgreSQL + object backup and isolated restore scripts                                                   | Database and object storage                    | Secret-safe logs, checksums, isolated target                          | No recorded real drill, application smoke, RLS/FK validation or measured RPO/RTO                       | NO                                     |
| Docker/CI                        | Web/API/Worker Dockerfiles and local build documentation; broad code CI                                             | Production images                              | No local secrets, reproducible context                                | CI does not build/scan images or emit SBOMs                                                            | NO                                     |

The durable account/tenant deletion states required by M4 do not exist. A generic `deleted_at` value cannot safely encode request ownership, a cancellable grace period, scheduled purge, worker ownership/retries, partial SQL/object progress, or a terminal result. M4 therefore stops before migration `0062`.

# Workspace/Organization Export

## Coverage

The current Worker exports workspace/member data plus projects, project sections, tasks, comments, attachment metadata, documents, goals, time logs, automations, forms, custom fields, saved views and activities.

It does not yet provide the authoritative M4 inventory. Notably missing or unproven are organization metadata, teams and role bindings, project memberships, task assignees/followers, tags where not embedded, dependencies/links, recurring tasks, reminders, checklists/approvals, comment mentions/replies, document hierarchy/versions/access, form submissions, goal links/check-ins/measurements, timesheets, automation executions, Sprints/assignments/snapshots/analytics events, integration metadata with explicit secret exclusion, scheduled reports, invitation history, and attachment binaries.

## Consistency

`buildArchive` opens a read-only `REPEATABLE READ` transaction, which is the correct basis for a coherent logical snapshot without locking the entire database.

## Files

JSON, PDF and XLSX are supported. JSON is the closest machine-readable representation, but there is no canonical ZIP containing a manifest, versioned entity files and packaged attachment binaries. Attachment rows are metadata only. Physical cleanup of expired export objects is explicitly deferred in ADR 0006.

## Security

Export creation, status and download are organization/workspace/requester scoped. Download requires a completed, unexpired job and returns a time-limited signed object-storage URL. Storage keys include unguessable job identifiers and the storage adapter is private. Cross-tenant and foreign-requester repository tests exist, but the final archive inventory still needs end-to-end authorization and stolen-ID tests.

## Secrets excluded

Authentication secrets are not among the current selected tables. However, the export uses broad row selection for several tables. The complete export must use explicit safe projections and a denylist regression test proving exclusion of password hashes, tokens, MFA/OAuth/integration secrets, encrypted invitation material, signed URLs and internal encryption metadata.

# Account Deletion

## Semantics

Not implemented. The user table has no lifecycle state and there is no durable deletion request, grace deadline, cancellation, worker claim, purge/anonymization completion or failure state. Sessions can already be revoked and MFA/OAuth/auth-token data can be removed, but they are not coordinated by a deletion workflow.

Shared content must not be destroyed when a contributor deletes a login. The proposed behavior is to disable authentication immediately when purge processing begins, revoke all sessions/tokens/OAuth identities/MFA material, remove memberships and personal settings, and retain shared authorship through an anonymized principal. Exact treatment of notifications, activity, security events and billing records requires product/legal approval.

## Ownership handling

A sole organization owner must be blocked from scheduling account deletion until ownership is transferred or a separately authorized organization deletion is scheduled. This must be enforced transactionally in the backend, not only in the UI.

## Security

Only the current user may request/cancel their account deletion. Request and cancellation require normal CSRF protection; request requires recent re-authentication and explicit confirmation. Scheduling must revoke other sessions at the defined policy point. No endpoint may accept an arbitrary target user ID for self-service deletion.

# Organization Deletion

## State/lifecycle

Not implemented. Required durable states are:

`requested -> scheduled -> processing -> completed`

Permitted exceptional transitions are `requested|scheduled -> canceled` and `processing -> failed -> scheduled` after a retry-safe recovery decision. Cancellation is forbidden after processing starts. “Completed” is represented by a non-sensitive tombstone/receipt because the tenant row and content may no longer exist.

Workspace deletion, if exposed as a separate product operation, needs the same lifecycle at workspace scope rather than overloading organization deletion.

## Authorization

Organization deletion must require an active owner, recent re-authentication, CSRF protection, explicit organization-name confirmation and a transactional sole-owner/ownership check. Non-owners and actors from other tenants must receive non-disclosing denial behavior.

## Object-storage cleanup

The purge must enumerate and delete attachment objects/previews, export archives, document objects and generated report artifacts. SQL completion cannot be recorded while required object deletions remain unconfirmed. Each object operation needs a durable idempotent item, retry state and non-secret error summary.

# Retention

## Technical retention matrix

| Data type                                    | Active lifetime                                    | Soft-delete duration                           | Hard-delete eligibility                                  | Backup interaction                                        | Customer-visible? | Exception                                          |
| -------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| Tasks/comments/documents/forms/goals/Sprints | While tenant is active                             | PRODUCT/POLICY DECISION REQUIRED               | After approved tenant/entity grace and dependency checks | May remain in older encrypted backups until backup expiry | Yes               | Shared attribution may be anonymized               |
| Attachments/previews                         | While referenced                                   | Configured: pending 2h, deleted 24h by default | Existing cleanup Worker                                  | May remain until backup expiry                            | Yes               | Object and SQL state must agree                    |
| Export archives                              | Until logical expiry; default 7 days, bounded 1–90 | Not applicable                                 | Eligible after expiry                                    | Backup inclusion/exclusion requires policy                | Yes               | Physical cleanup job is missing                    |
| Notifications                                | PRODUCT/POLICY DECISION REQUIRED                   | PRODUCT/POLICY DECISION REQUIRED               | After approved policy                                    | May remain until backup expiry                            | Yes               | Some delivery evidence may be operational          |
| Invitations/outbox                           | Until invitation/delivery terminal state           | Payload is scrubbed after terminal processing  | Metadata retention requires policy                       | May remain until backup expiry                            | Partly            | Never retain usable encrypted tokens unnecessarily |
| Sessions/password-reset/auth tokens          | Until revocation or configured expiry              | None                                           | On expiry/account purge                                  | May remain until backup expiry                            | Partly            | Security-event evidence is separate                |
| Activity/security/audit logs                 | PRODUCT/POLICY DECISION REQUIRED                   | Usually append-only by design                  | Only under approved security/legal policy                | May remain until backup expiry                            | Partly            | Legal/operational exception likely                 |
| Sprint analytics history                     | While customer-owned                               | PRODUCT/POLICY DECISION REQUIRED               | With tenant purge or approved history policy             | May remain until backup expiry                            | Yes               | Export before deletion should be available         |
| Billing invoices/payment identifiers         | According to approved finance/legal policy         | Not ordinary soft-delete content               | PRODUCT/LEGAL DECISION REQUIRED                          | May remain until backup expiry                            | Yes               | Must be separated/pseudonymized if retained        |
| Backups                                      | Default tooling value 30 days                      | Not applicable                                 | Provider retention/immutability policy                   | This is the backup boundary                               | No                | Default is not an SLA or legal policy              |

Existing numeric defaults are implementation configuration, not a product/legal promise. All cells marked PRODUCT/POLICY DECISION REQUIRED must be approved before destructive purge behavior is enabled.

# Stripe

## Staging scenarios tested

No evidence of a real Stripe TEST/STAGING checkout-to-webhook operational run was found. Provider unit tests mock Stripe requests, and database integration tests exercise subscription lifecycle semantics. Checkout, portal and plan/seat update code exists, but the real staging gate remains open.

## Idempotency

Checkout and portal requests use API idempotency keys. Stripe webhook signatures are verified, and webhook event IDs are persisted through the tenant idempotency repository. Re-delivery of the same event therefore replays the completed result instead of applying it twice. Repository integration tests also prove older provider timestamps cannot overwrite newer subscription state.

## Grace/recovery

`invoice.payment_failed` persists `grace_period` and an expiry; a scheduled Worker expires due grace periods. Successful/paid invoice events restore active state and clear the grace deadline. Cancellation downgrades the organization to free limits. The integration test covers failure, stale events, recovery, cancellation and invoice upsert behavior.

## Entitlements

Persisted backend billing state, organization plan and usage-limit rows are authoritative; the frontend is not the entitlement source. Concurrent enforcement for every requested dimension and real Stripe propagation must be rerun in the eventual M4 execution gate. Export/account access behavior during billing failure also needs an explicit product rule.

# Backup / Restore

## Actual drill

Not performed or evidenced. `deploy/backup.sh` creates PostgreSQL and object-storage artifacts, encrypts them with age, computes checksums, uploads them to an independent S3-compatible destination and applies configured retention. `deploy/restore.sh` verifies checksums before decryption and restores into the isolated `deploy/docker-compose.restore.yml` environment.

## Backup duration

Not measured.

## Restore duration

Not measured.

## RPO/RTO capability

No measured capability or approved business target is documented. The backup schedule determines achievable RPO; a successful isolated drill and application validation are required to measure RTO. No SLA is claimed.

## Smoke tests

The restore script verifies database connectivity and restores objects, but it does not prove application reads, migration parity, object resolution through the application, RLS isolation or critical foreign keys. These checks must be added to and executed in a non-production drill after the schema decision.

# CI Containers

## Image builds

Dockerfiles exist for Web, API and Worker and have documented local commands. The current GitHub Actions workflow builds applications but does not build all three production container images.

## Scan

No container vulnerability scan is configured. Add one scanner in the existing GitHub Actions ecosystem and define a deliberate actionable high/critical policy rather than failing on informational findings.

## SBOM

No SBOM artifact generation was found.

## Artifact behavior

CI currently does not publish image/SBOM/scan artifacts. The future workflow must build only from tracked context, never inject local `.env` or secrets, identify images immutably, retain SBOM/scan results and avoid automatic deployment.

# Deployment Runbook

`deploy/README.md` documents staging, secrets, images, backup, isolated restore and rollback. It correctly treats migrations as forward-only and prefers forward fixes instead of claiming automatic down-migration safety. It still needs one consolidated production checklist with pre-deploy validation, backup decision, migration ordering, API/Web/Worker rollout, health/application smoke checks, rollback criteria, incident ownership and links to recorded restore drills.

# Security / RLS

Existing exports use tenant transactions and requester ownership. The proposed lifecycle must preserve FORCE RLS for tenant-scoped tables, use an explicit self policy for account requests, and restrict deletion scheduling to owners. Required negative tests include foreign export/download identifiers, deletion of another account, non-owner organization deletion, CSRF, webhook spoofing and purge-worker tenant isolation. Destructive tests must use isolated non-production data.

# Arabic / Accessibility

No customer-facing M4 UI was added in this audit. Future export/deletion/billing-state strings require Arabic and English coverage with RTL/LTR safeguards. Destructive dialogs need labeled controls, keyboard focus management, accessible validation, explicit textual warnings and must not communicate danger by color alone.

# Tests

Actual test count executed for this audit: **0**. This was a read-only capability audit and intentionally stopped at the schema approval boundary. Existing relevant tests were inspected for export tenancy/idempotency, Stripe provider behavior, subscription lifecycle/out-of-order events, webhook signature verification, grace expiry, attachment cleanup and restore script structure. The complete M4 test matrix has not been executed and must not be reported as passing.

# Full Gates

Not run in this stopped phase. `pnpm ci`, typecheck, lint, format check, tests, build, Docker image builds, scans and the isolated restore drill remain execution work after approval and implementation. This report does not change the closed status of M1–M3.

# Database

`0062_data_lifecycle` is generated, pristine-verified, applied to Development, and now immutable.

New migration created: **YES — 0062_data_lifecycle**
Migration after 0062 created: **NO**
Backfill executed: **NO**

## Approved and implemented `0062_data_lifecycle`

### 1. Tables

1. `account_deletion_requests`: authoritative workflow record for deleting one account. The associated `users` row is retained as an anonymized authorship principal.
2. `organization_deletion_requests`: authoritative workflow record for deleting one Organization. It exists only while the Organization exists and is removed by the final tenant cascade after a receipt is committed.
3. `data_purge_checkpoints`: durable domain/partition checkpoints for bounded discovery, deletion and verification batches.
4. `data_purge_items`: durable executable work items for object storage and external-provider resources, plus exceptional relational items that cannot be handled safely by keyset batches.
5. `data_deletion_receipts`: permanent non-PII completion evidence. It has no subject ID, user ID, Organization ID, request ID, object key, provider ID, error text or foreign key back to deleted data.
6. Existing `users` and `organizations` receive coarse operational lifecycle columns only. They are not the workflow source of truth. Workspace deletion is explicitly outside `0062`.

### 2. Columns

`account_deletion_requests`:

- `id uuid primary key`
- `user_id uuid not null`
- `status deletion_request_status not null default 'requested'`
- `policy_version varchar(64) not null`
- `requested_at timestamptz not null`, `reauthenticated_at timestamptz not null`
- `scheduled_for timestamptz null`, `processing_started_at timestamptz null`, `retry_at timestamptz null`
- `canceled_at timestamptz null`, `completed_at timestamptz null`, `failed_at timestamptz null`
- `claim_token uuid null`, `claimed_at timestamptz null`, `heartbeat_at timestamptz null`
- `attempts integer not null default 0`
- `last_error_code varchar(64) null`, `last_error_summary varchar(512) null`; both are non-secret and non-content-bearing
- `created_at timestamptz not null`, `updated_at timestamptz not null`

`organization_deletion_requests` has the same workflow columns, plus:

- `organization_id uuid not null`
- `requested_by_user_id uuid null`
- `confirmation_version varchar(64) not null`; it records the confirmation contract version, not the entered Organization name

`data_purge_checkpoints`:

- `id uuid primary key`
- Exactly one of `account_request_id uuid` or `organization_request_id uuid`
- `domain purge_domain not null`, `partition_key varchar(128) not null default 'default'`
- `status purge_checkpoint_status not null default 'pending'`
- `cursor jsonb not null default '{}'`; a validated keyset cursor, never arbitrary SQL
- `batch_size integer not null`
- `discovered_count bigint not null default 0`, `completed_count bigint not null default 0`
- `attempts integer not null default 0`, `retry_at timestamptz null`
- `claim_token uuid null`, `claimed_at timestamptz null`, `heartbeat_at timestamptz null`
- `last_error_code varchar(64) null`, `last_error_summary varchar(512) null`
- `last_batch_at timestamptz null`, `verified_at timestamptz null`
- `created_at timestamptz not null`, `updated_at timestamptz not null`

`data_purge_items`:

- `id uuid primary key`
- Exactly one of `account_request_id uuid` or `organization_request_id uuid`
- `domain purge_domain not null`, `locator_kind purge_locator_kind not null`
- `locator jsonb not null`; executable only by the allow-listed handler for its domain/kind and validated against that handler's fixed schema. It cannot contain SQL, signed URLs, credentials or tokens.
- `locator_fingerprint char(64) not null`; lowercase SHA-256 of `(domain, locator_kind, canonical_json(locator))`
- `status purge_item_status not null default 'pending'`
- `attempts integer not null default 0`, `retry_at timestamptz null`
- `claim_token uuid null`, `claimed_at timestamptz null`, `heartbeat_at timestamptz null`
- `last_error_code varchar(64) null`, `last_error_summary varchar(512) null`
- `completed_at timestamptz null`, `verified_at timestamptz null`
- `created_at timestamptz not null`, `updated_at timestamptz not null`

`data_deletion_receipts`:

- `id uuid primary key`, generated only during the final completion transaction
- `subject_type deletion_subject_type not null`, `outcome deletion_receipt_outcome not null`
- `schema_version smallint not null`, `verification_version varchar(64) not null`
- `domain_summary jsonb not null`; allow-listed domain names and aggregate counts only
- `completed_at timestamptz not null`
- No free text or linkable subject/request identifier

Coarse entity columns:

- `users.lifecycle_state user_lifecycle_state not null default 'active'`
- `users.auth_disabled_at timestamptz null`, `users.anonymized_at timestamptz null`
- `organizations.lifecycle_state organization_lifecycle_state not null default 'active'`
- `organizations.write_frozen_at timestamptz null`

The request row is authoritative. Entity state is only a denormalized operational guard and must be reconciled from the active request after a crash.

### 3. Enums

- `deletion_request_status`: `requested`, `scheduled`, `processing`, `retry_wait`, `failed`, `completed`, `canceled`
- `user_lifecycle_state`: `active`, `deletion_pending`, `auth_disabled`, `anonymized`
- `organization_lifecycle_state`: `active`, `deletion_pending`, `write_frozen`
- `purge_checkpoint_status`: `pending`, `processing`, `retry_wait`, `failed`, `verified`
- `purge_item_status`: `pending`, `processing`, `retry_wait`, `failed`, `completed`, `verified`
- `purge_locator_kind`: `sql_keyset`, `object_key`, `provider_resource`
- `deletion_subject_type`: `account`, `organization`
- `deletion_receipt_outcome`: `anonymized`, `purged`
- `purge_domain`: a closed allow-list for account security/profile/memberships, tenant relational domains, attachments/previews, documents, exports/reports, integration/OAuth revocation, billing-provider handling and final verification. Adding a domain requires explicit schema/code review.

No enum encodes a retention duration.

### 4. FKs / `ON DELETE`

- `account_deletion_requests.user_id -> users.id ON DELETE RESTRICT`: the User principal is retained and anonymized.
- `organization_deletion_requests.organization_id -> organizations.id ON DELETE CASCADE`: operational request history is removed with the tenant after the non-PII receipt is inserted.
- `organization_deletion_requests.requested_by_user_id -> users.id ON DELETE SET NULL`: account anonymization cannot orphan or cancel tenant deletion.
- Each checkpoint/item request FK uses `ON DELETE CASCADE`; a check requires exactly one parent request FK.
- `data_deletion_receipts` has no FK to users, organizations or requests.
- No new FK targets `workspaces`.
- Legally/operationally retained records may be detached or pseudonymized only after policy approval. `0062` must not choose categories or durations implicitly through cascade behavior.

### 5. Indexes

- `UNIQUE (user_id) WHERE status IN ('requested','scheduled','processing','retry_wait','failed')`.
- `UNIQUE (organization_id) WHERE status IN ('requested','scheduled','processing','retry_wait','failed')`.
- Due-work indexes on `(status, scheduled_for, retry_at)` restricted to `scheduled`/`retry_wait`.
- Stale-claim indexes on `(status, heartbeat_at)` restricted to `processing`.
- History indexes on `(user_id, created_at desc)` and `(organization_id, created_at desc)`.
- Separate partial unique checkpoint indexes on `(account_request_id, domain, partition_key)` and `(organization_request_id, domain, partition_key)` for their non-null scope.
- Separate partial unique item indexes on `(account_request_id, domain, locator_fingerprint)` and `(organization_request_id, domain, locator_fingerprint)` for their non-null scope.
- Purge work indexes on `(status, retry_at, created_at)` and `(status, heartbeat_at)`.
- Receipt index on `completed_at` only; there is intentionally no subject lookup index.

### 6. Checks

- State/timestamp checks require the timestamp relevant to the current state, retain `processing_started_at` once irreversible work begins, and prohibit `canceled` when `processing_started_at is not null`.
- `scheduled_for >= requested_at`; the interval comes only from approved policy/configuration.
- `attempts >= 0`; claim token/time/heartbeat are all present for processing work or all absent otherwise.
- `retry_at` is required only for `retry_wait`; state-specific terminal timestamps are required for `failed`, `completed` and `canceled`.
- Every checkpoint/item has exactly one request parent.
- `batch_size` is positive and bounded; counters are non-negative.
- `cursor` and `locator` are JSON objects. Domain handlers perform stricter typed validation before execution.
- `locator_fingerprint ~ '^[a-f0-9]{64}$'`; the repository must recompute and compare the canonical hash on insertion.
- Error fields are bounded and cannot contain row content, object URLs, credentials or provider payloads.
- Verified checkpoints/items require `verified_at`. Completion is prohibited if a required domain checkpoint is missing or any child is not `verified`.
- Entity lifecycle timestamp checks match their coarse state, but the request status always wins during reconciliation.

### 7. RLS

- Enable and force RLS on request tables, checkpoints and items.
- An actor may select/insert its own account request and cancel it only in `requested` or `scheduled`; no endpoint/policy accepts a different target user.
- Only an active Organization owner with backend-confirmed recent re-authentication may select/insert/cancel its Organization request. Members and foreign tenants cannot mutate it.
- Checkpoints/items have no customer application policies. Only the existing narrowly controlled Worker/maintenance context may mutate them.
- Receipt insertion is Worker-only; no customer subject-ID lookup exists.
- At `processing`, Organization state becomes `write_frozen`. Existing tenant-table INSERT/UPDATE/DELETE policies must require Organization state `active` or `deletion_pending`; only the controlled purge path can mutate a frozen tenant.
- API authorization mirrors but does not replace RLS. No broad cross-tenant bypass is added.

### 8. State transitions

- `requested -> scheduled`: authorization, ownership, recent re-authentication, confirmation and approved policy version pass.
- `requested|scheduled -> canceled`: allowed transactionally before processing; the coarse entity state returns to `active` when no active request remains.
- `scheduled -> processing`: Worker claims with `FOR UPDATE SKIP LOCKED`; account becomes `auth_disabled`, Organization becomes `write_frozen` before destructive work.
- `processing -> retry_wait`: transient failure preserves all progress, increments attempts, clears the lease and sets bounded-backoff `retry_at`.
- `retry_wait -> processing`: an automatic due retry resumes without replaying verified work.
- `processing|retry_wait -> failed`: non-retryable failure or exhausted retry policy. `failed` remains unresolved and participates in active-request uniqueness.
- `failed -> retry_wait`: explicit authorized operator retry after remediation; checkpoints, fingerprints, attempts and write freeze remain intact.
- `processing -> completed`: only through the completion algorithm. Account history remains linked to the retained anonymized principal. Organization completion writes the receipt and deletes the Organization, cascading operational history.
- Cancellation is forbidden after `processing_started_at` is set. There is no product rollback after irreversible processing.

### 9. Existing-data behavior

- Existing users and organizations receive coarse state `active` through the column-addition/default strategy.
- No request, checkpoint, purge item or receipt is created. No Backfill is executed.
- Existing `deleted_at` values never become deletion requests automatically; reconciliation requires separate approval.
- Existing users are not anonymized. A future account purge retains the stable User ID for shared authorship, disables login, removes sessions/tokens/MFA/OAuth identities and personal settings, and clears/replaces direct profile identifiers with a non-routable unique email and generic deleted-user presentation.
- No Workspace column, request or behavior is added.
- No legal, billing, security-log or backup retention duration is added or inferred. Unclassified policy blocks final purge enablement rather than being guessed.

### 10. Worker completion algorithm

1. Atomically claim a due request with a lease. Reconcile coarse entity state from the authoritative request, revoke account authentication or freeze Organization writes, and emit metadata-only observability.
2. Materialize the approved purge-domain plan and deterministic checkpoints. Insert executable items with `ON CONFLICT DO NOTHING` using canonical locator fingerprints.
3. Process relational domains in bounded keyset batches. Commit cursor and counts after every batch; never wrap an entire Organization purge in one transaction.
4. Process object/provider items through the allow-listed `(domain, locator_kind)` handler. Validate the locator, perform an idempotent action, then independently verify absence or acknowledgement before `verified`.
5. On transient failure, retain progress and transition to `retry_wait` with bounded backoff. On exhausted/non-retryable failure, transition to `failed`, preserve the write freeze and require explicit remediation. Never report partial success as completion.
6. Verify every domain independently: zero remaining purge-eligible SQL rows, all expected objects absent, required provider revocations acknowledged, and all discovered items `verified`; then mark its checkpoint `verified` with verifier version/time.
7. Final verification requires the exact configured domain set, no pending/processing/retry/failed child, no stale claim, reconciled counts, and a repeated scoped SQL/object/provider check to close discovery races.
8. Account completion uses one transaction to remove remaining personal/security material, replace direct identifiers, set the retained User to `anonymized`, mark the request `completed`, and insert a non-PII aggregate receipt.
9. Organization completion uses one final transaction to re-check `write_frozen`, verify approved retained-record handling, insert the non-PII receipt, and delete the Organization. Cascades remove tenant data and operational deletion history; the FK-free receipt survives.
10. Completion/failure telemetry may use operational request IDs only while those rows exist and never copies them into the permanent receipt. Backup expiry stays independent; the algorithm invents no retention duration.

# Deferred

- M5 Staging/Beta
- Burnup
- Capacity
- Legacy Analytics Backfill
- P2/P3 competitive features

No M5 or unrelated feature work has started.
