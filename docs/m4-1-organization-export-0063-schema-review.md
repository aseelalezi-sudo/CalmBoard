# M4.1 Organization Export / Proposed 0063 Schema Review

Review date: 2026-08-11
Baseline: `0062_data_lifecycle` applied and immutable
Execution outcome: the proposal below was approved, generated as `0063_export_scope`, verified on pristine and current-database copies, applied to Development, and is now immutable. No `0064`, Backfill, or historical archive regeneration was performed.

## 1. Current `export_jobs` audit

### Table and columns

`export_jobs` is the single durable queue and artifact record for Workspace portability exports and scheduled Workspace reports.

| Column               | Current definition                             | Semantics                                                            |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `id`                 | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`   | Durable public job identifier                                        |
| `organization_id`    | `uuid NOT NULL`                                | Owning tenant                                                        |
| `workspace_id`       | `uuid NOT NULL`                                | Required Workspace scope; this is the M4.1 blocker                   |
| `requested_by`       | `uuid NOT NULL`                                | Authenticated requester and status/download owner                    |
| `report_schedule_id` | `uuid NULL`                                    | Optional scheduled-report origin                                     |
| `scheduled_for`      | `timestamptz NULL`                             | Scheduled occurrence paired with `report_schedule_id`                |
| `format`             | `varchar(20) NOT NULL DEFAULT 'json'`          | `json` means canonical portability ZIP; `pdf` and `xlsx` are reports |
| `idempotency_key`    | `varchar(256) NOT NULL`                        | Durable request/schedule idempotency key                             |
| `status`             | `export_job_status NOT NULL DEFAULT 'pending'` | `pending`, `processing`, `completed`, `dead`, or `expired`           |
| `attempts`           | `integer NOT NULL DEFAULT 0`                   | Monotonic Worker attempt count                                       |
| `max_attempts`       | `integer NOT NULL DEFAULT 5`                   | Retry ceiling                                                        |
| `available_at`       | `timestamptz NOT NULL DEFAULT now()`           | Next eligible claim time                                             |
| `claimed_at`         | `timestamptz NULL`                             | Lease timestamp while processing                                     |
| `claim_token`        | `uuid NULL`                                    | Fences stale Workers                                                 |
| `object_key`         | `text NULL`                                    | Private object-store key after completion                            |
| `file_name`          | `varchar(255) NULL`                            | Download filename                                                    |
| `content_type`       | `varchar(100) NULL`                            | Persisted server-selected media type                                 |
| `file_size`          | `bigint NULL`                                  | Generated artifact size                                              |
| `checksum_sha256`    | `varchar(64) NULL`                             | Artifact SHA-256                                                     |
| `completed_at`       | `timestamptz NULL`                             | Completion timestamp                                                 |
| `expires_at`         | `timestamptz NULL`                             | Logical download expiry                                              |
| `last_error`         | `text NULL`                                    | Latest bounded error description                                     |
| `created_at`         | `timestamptz NOT NULL DEFAULT now()`           | Creation time                                                        |
| `updated_at`         | `timestamptz NOT NULL DEFAULT now()`           | Last state change                                                    |

### Current constraints, FKs, indexes, trigger, and RLS

- FKs are `organization_id -> organizations.id ON DELETE CASCADE`, `workspace_id -> workspaces.id ON DELETE CASCADE`, `requested_by -> users.id ON DELETE CASCADE`, and `report_schedule_id -> report_schedules.id ON DELETE SET NULL`.
- `export_jobs_idempotency_unique` is globally unique on `idempotency_key`.
- `export_jobs_schedule_occurrence_unique` is partial-unique on `(report_schedule_id, scheduled_for)` when both values are present.
- `export_jobs_tenant_requester_idx` covers `(organization_id, workspace_id, requested_by, created_at)`; `export_jobs_due_idx` covers `(status, available_at, claimed_at)`.
- CHECKs enforce the format allow-list, paired scheduled-report fields, non-negative attempts, processing lease shape, and terminal artifact shape.
- `validate_export_job()` proves the Workspace belongs to the Organization, requires an active matching membership on insert, validates a linked report schedule, makes job identity immutable, prevents attempt counters decreasing, and protects terminal states except trusted dead-letter retry.
- RLS and `FORCE RLS` are enabled. The current `tenant_isolation` policy uses `app_tenant_matches(organization_id, workspace_id)` but does not itself enforce `requested_by = app_current_actor_id()`; requester ownership is currently added by the repository query.

### Current API, authorization, download, Worker, and cleanup behavior

- `POST /workspaces/export`, `GET /workspaces/export/:jobId`, and `GET /workspaces/export/:jobId/download` require `data.export`.
- The authenticated session overwrites caller-supplied actor identity. Repository reads require the exact Organization, Workspace, and requester, so a guessed/foreign job ID is returned as not found.
- The authorization resolver considers Organization role bindings plus matching Workspace bindings for Workspace requests. For an Organization-only request it considers only an active Organization-wide membership and Organization-scoped role/override. Therefore a Workspace-only `data.export` grant does not imply Organization-wide export permission.
- Access is re-authorized on every status/download request. Under the existing convention, an archive is no longer downloadable after the requester loses active membership or `data.export`, even if it was already generated.
- Download requires `completed`, a persisted object, and a future `expires_at`; the API returns a five-minute signed URL rather than the internal object reference.
- A maintenance Worker polls with an empty BullMQ payload, claims persisted DB rows using `FOR UPDATE SKIP LOCKED`, a claim token, stale-claim recovery, bounded attempts, and exponential backoff. The DB row—not the queue payload—is authoritative.
- Object keys are deterministic per job, so a retry overwrites the same object rather than creating uncontrolled archives.
- Workspace JSON/ZIP relational data is read in one `REPEATABLE READ READ ONLY` transaction. Attachment and preview bytes are read after commit and individually hashed; this is the declared DB/object consistency boundary.
- The current portability implementation accumulates relational rows, attachment buffers, and the final JSZip archive in process memory. That is not acceptable for potentially large Organization exports and must be replaced by bounded reads plus a streaming ZIP/private temporary file in the implementation phase.
- API export creation currently receives only the general actor rate limit. There is a bounded Worker batch size and retry ceiling, but no dedicated per-Organization concurrency policy. M4.1 must add operational concurrency control without inventing a product usage quota.
- Logical expiry is enforced, but no Worker currently marks expired export rows, deletes their objects, or cleans orphaned artifacts from failed finalization. The accepted ADR explicitly leaves physical deletion as follow-up.
- Existing tests cover Workspace format/idempotency, foreign requester denial, expiry-aware download, claim fencing/recovery, one-time completion, ZIP manifest, attachment bytes, checksum, and a representative encrypted integration secret. They do not cover Organization scope, permission revocation, physical cleanup, comprehensive secret denylisting, or bounded-memory behavior.

## 2. Approved-scope design for M4.1 implementation

- Support exactly `workspace` and `organization`; no project, user, portfolio, or generic scope.
- Reuse the existing non-null `organization_id`. No second tenant identifier or new table is needed.
- Persist scope in the job and require the Worker to branch only on that persisted value.
- Workspace jobs retain the existing archive/report behavior. Organization jobs use `format = 'json'`, which already represents the canonical versioned ZIP rather than introducing a new format.
- Organization API routes must resolve authorization with `{ organizationId }` only and require `data.export`. Workspace routes continue resolving `{ organizationId, workspaceId }`.
- Status and download repositories must additionally bind `export_scope`, tenant, requester, and the relevant Workspace invariant. Loss of membership or permission continues to revoke download access.
- The Organization archive must use one Organization-wide `REPEATABLE READ` relational snapshot. It must not call the existing Workspace builder once per Workspace using independent transactions.
- Relational tables must be read through explicit safe projections and bounded cursors/pages within that transaction. ZIP output must be streamed to a restricted temporary file or multipart private upload; it must not retain all Organization rows and binaries in memory.
- Attachment and preview objects remain outside the relational transaction. Their archive paths, sizes, hashes, and read-after-snapshot consistency boundary must be recorded in `manifest.json`; signed source URLs and internal object references must never be archived.
- The existing secret projection denylist must be expanded and tested against password hashes, sessions, auth/refresh tokens, MFA material, OAuth secrets, integration ciphertext/credentials, invitation encrypted token material, encryption metadata/keys, and signed URLs.
- Both scopes must share the same deterministic per-job object key, expiry, object deletion, failed-job orphan cleanup, and retry behavior. Cleanup must be idempotent and safe under concurrent Workers.
- A dedicated technical concurrency guard may cap simultaneously processing Organization jobs per Organization. It is abuse protection, not a new billable/product size limit.

## 3. Exact proposed `0063_export_scope` schema

### Tables modified

- Modify only `export_jobs`.
- Create no new tables.

### Columns

1. Add `export_scope export_scope NOT NULL DEFAULT 'workspace'`.
2. Change `workspace_id` from `NOT NULL` to nullable.
3. Do not add another `organization_id`; the existing non-null column remains authoritative.
4. Keep all other columns and defaults unchanged.

The default remains `workspace` after migration to preserve rolling-deployment compatibility with the existing API and scheduled-report inserter. Organization creation must always persist `organization` explicitly.

### Enums

Create one closed enum:

```sql
CREATE TYPE public.export_scope AS ENUM ('workspace', 'organization');
```

No other enum values or export scopes are proposed.

### CHECK constraints

Add:

```sql
CONSTRAINT export_jobs_scope_target_check CHECK (
  (export_scope = 'workspace' AND workspace_id IS NOT NULL)
  OR
  (export_scope = 'organization' AND workspace_id IS NULL)
)
```

Add:

```sql
CONSTRAINT export_jobs_organization_format_check CHECK (
  export_scope <> 'organization' OR format = 'json'
)
```

Replace the existing scheduled-fields CHECK with the equivalent stricter form:

```sql
CONSTRAINT export_jobs_schedule_fields_check CHECK (
  (report_schedule_id IS NULL AND scheduled_for IS NULL)
  OR
  (
    report_schedule_id IS NOT NULL
    AND scheduled_for IS NOT NULL
    AND export_scope = 'workspace'
    AND workspace_id IS NOT NULL
    AND format IN ('pdf', 'xlsx')
  )
)
```

Keep the existing format, attempts, claim-state, and result-state CHECKs unchanged.

`validate_export_job()` must be replaced in 0063 without changing its unrelated retry rules:

- For `workspace`, retain the Workspace-to-Organization lookup and active membership rule.
- For `organization`, require an active Organization-wide membership (`memberships.workspace_id IS NULL`) for `requested_by`; the API remains responsible for the `data.export` permission decision.
- A linked report schedule is valid only for `workspace` scope.
- Make `export_scope`, `organization_id`, `workspace_id`, and `requested_by` immutable. Nullable comparisons must use `IS DISTINCT FROM`, especially for `workspace_id`.
- Continue protecting format, schedule identity, idempotency key, maximum attempts, monotonic attempts, and terminal status using the existing trusted-retry semantics.

### FKs / `ON DELETE`

- Keep `organization_id -> organizations.id ON DELETE CASCADE` unchanged.
- Keep the now-nullable `workspace_id -> workspaces.id ON DELETE CASCADE` unchanged. Organization rows contain `NULL`, so they do not depend on a Workspace.
- Keep `requested_by -> users.id ON DELETE CASCADE` unchanged.
- Keep `report_schedule_id -> report_schedules.id ON DELETE SET NULL` unchanged.
- Add no new FK.

### Indexes

- Keep `export_jobs_idempotency_unique`, `export_jobs_schedule_occurrence_unique`, `export_jobs_tenant_requester_idx`, and `export_jobs_due_idx` unchanged. The tenant/requester index supports Organization rows through `workspace_id IS NULL`, whose meaning is guaranteed by the scope CHECK.
- Add one physical-cleanup work index:

```sql
CREATE INDEX export_jobs_expired_cleanup_idx
ON export_jobs (expires_at, id)
WHERE status = 'completed' AND expires_at IS NOT NULL;
```

No speculative scope index is required by the audited query shapes.

### RLS changes

Keep RLS enabled and forced. Replace only the existing `tenant_isolation` policy with:

```sql
USING (
  requested_by = public.app_current_actor_id()
  AND public.app_tenant_matches(organization_id, workspace_id)
)
WITH CHECK (
  requested_by = public.app_current_actor_id()
  AND public.app_tenant_matches(organization_id, workspace_id)
)
```

Consequences:

- Workspace context can access only matching Workspace rows owned by the current actor.
- Workspace context cannot access an Organization row because its `workspace_id` is `NULL` and the policy does not enable `allow_organization_wide_row`.
- Organization-only context can access Organization rows for the same tenant and actor.
- The maintenance Worker continues through the dedicated non-superuser `BYPASSRLS` connection; no application role receives `BYPASSRLS`.
- Permission checks stay in the API authorization layer. Duplicating RBAC graph resolution inside RLS would add recursion and policy-maintenance risk.

### Existing-row behavior

- Every existing row receives `export_scope = 'workspace'` through the deterministic non-null column default.
- Every existing row already has a non-null `workspace_id`, so it satisfies the new scope CHECK.
- No export content is changed, regenerated, or re-uploaded.
- No request, artifact, or customer record is reconstructed.
- This is a deterministic schema/default transformation required to describe existing rows, not a customer-data Backfill.
- Add the enum and populated defaulted column before validating the new CHECK; only then drop `workspace_id NOT NULL`. Preserve old-application compatibility throughout a rolling deployment.

## 4. Review result

The proposed 0063 is sufficient to represent both approved scopes without a new table. It also closes the schema-side cleanup query gap. It does not by itself complete Organization export: API/repository branching, Organization-level authorization tests, one-snapshot bounded/streaming archive generation, comprehensive secret-exclusion tests, physical cleanup, retry/orphan cleanup, and abuse/concurrency controls remain implementation work after explicit migration approval.

New migration created: **NO**
Backfill executed: **NO**
