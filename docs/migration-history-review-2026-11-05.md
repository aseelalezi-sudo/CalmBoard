# Migration history review — 2026-11-05

## Current finding

Update: the user approved the explicit local development baseline, and it was
applied on 2026-11-05. `pnpm db:migrate:status` now succeeds for that database
with 67 recorded entries and zero pending migrations. Original SQL/history hashes
remain unchanged. The missing originals are still unavailable; this is a scoped
acceptance of the development state, not recovered provenance. Production and
Staging cannot use this decision. See [ADR 0030](./adr/0030-explicit-development-migration-baseline.md).

A read-only audit of the configured development database found 67 recorded
migrations, with no missing timestamps. Three recorded hashes differ from the
SQL files in this checkout. This is evidence of differing historical bytes; it
does not establish why the difference happened or prove what schema was applied.

| Migration                         | Recorded SHA-256                                                   | Current SQL SHA-256                                                | Result                                                       |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `0040_secret_reptil`              | `8bb14833c0608cadfe328befb0e0c68c20b6e0e4a4b4730d7698f595d4122b71` | `0eb5feac648d7301c283736bd9797bdd0fba5699f6db1ee2a22b38878220a473` | Original unavailable; approved development baseline          |
| `0041_productive_roland_deschain` | `d666c6d25ad5c2127505f091ce0af217a77058dfa44aea93aa12ddf8c98afab8` | `916e0f56f7b27f2a3bd317a963605689967f84c5e55460c72023a574135334a2` | Original unavailable; approved development baseline          |
| `0058_sprints_permissions`        | `e3a9191d82aeccd01a2ea08772e3854d8ed697235676719e1c295baa6796c307` | `804f522f1029602b916ddbb9250e03c97e78c4379e03d7c9104b528eaf3b0508` | Exact original recovered; format-only compatibility verified |

## Recovered 0058

The original was recovered byte-for-byte from the local image that currently
has tag `calmboard-api:latest`, pinned during extraction to immutable image ID:

`sha256:868db360486032a4be38f760eb44351618cbec9694d004249e532574b3ae2b5b`

Path inside the image:
`/app/node_modules/@calmboard/database/migrations/0058_sprints_permissions.sql`.
The extracted bytes hash exactly to the recorded `e3a919...` value above.

Compared with the checkout, the original contains a trailing space after each of
the two `FROM "roles" CROSS JOIN "permissions"` lines and lacks the final newline.
No SQL token, string literal or permission grant differs. The runner accepts only
this exact historical hash paired with the exact current hash. Both SQL files and
the database's recorded hash remain unchanged. Tests reconstruct the original
format and reject any other hash or a changed current file.

Local extraction evidence is stored under `artifacts/migration-originals/`, with
the original bytes and `provenance.json`; these local artifacts are not tracked.

## Missing originals for 0040 and 0041

The original hashes were not found in available Git history or the inspected
local project images. Simple LF/CRLF, BOM and end-of-file variations of the
current files did not match them. The available inspected images contain the
current bytes for these two files. No compatibility entry has been invented.

Before explicit adoption, the strengthened runner refused these two mismatches
without applying SQL. It now accepts only the approved database-bound development
decision described below; another database still needs its own review. Normal
application startup does not run migrations and was not stopped for this audit.

The user confirmed that no known original copy is available. A fresh disposable
reference database was migrated through all 67 entries, then its catalog was
compared with the configured database in a read-only transaction. Across 3503
catalog definitions in each database, the comparison found no differences in
the inspected tables, columns, constraints, indexes, enum types, triggers,
views or RLS flags/policies. The two remaining textual differences are the
formatting of `validate_goal_child_scope()` and `validate_goal_task_scope()`;
their shown SQL tokens and literals match on review. This comparison does not
cover every historical data transformation, data contents, ownership or grants.

Reconstructing candidate original files from the stored function bodies and
simple formatting variations did not recover the recorded full-file hashes.
Schema similarity is therefore not used to override either unknown hash.
Catalog evidence is in `artifacts/migration-schema-audit-2026-11-05.json`.

## Resolution options reviewed

Recover the original SQL or the release/source artifact used when `0040` and
`0041` were applied. Compare the exact bytes and the intended schema/data effects,
then reproduce the upgrade on an isolated copy before approving any reconciliation.
An exact, proven format-only historical variant can be handled like `0058`.
Semantic differences need a reviewed forward repair and explicit compatibility
decision for the historical entry.

If the original artifacts cannot be recovered, an audited baseline/adoption
process with verified schema/data and a backup is required. No automatic baseline
adoption or hash replacement is part of this change. This document does not
authorize resetting the development database or deleting its data.

Existing migration SQL, journal timestamps, and live migration records were not
rewritten. Migration tests create and remove their own isolated databases.

## Recovery checkpoint and approved decision

An encrypted local checkpoint was created and restored successfully on 2026-11-05:
`artifacts/local-recovery/calmboard_recovery_9188_69b8dfb8ad3b479f`.
All 92 tables and 37,336 rows matched the source's exported snapshot, including
the 67 unchanged historical migration records. Receipt authentication and archive
checksum verification also rejected modified test copies. See
[local-database-recovery.md](./local-database-recovery.md) for reproduction,
key recovery requirements and the limits of this local checkpoint.

With the original SQL unavailable, the approved decision is to accept the
**current state of this development database as an explicit baseline**, while
retaining the fact that the exact historical effects of 0040/0041 are unknown.
This is a provenance exception, not proof that the missing SQL was equivalent.

The approved implementation is limited to:

1. Recheck the source cluster system identifier, database OID, exact recorded
   history, the first 67 checkout hashes, and the reviewed catalog evidence while
   holding the migration runner's existing advisory lock. Refresh the checkpoint
   and catalog comparison if the reviewed state changed.
2. Test the baseline mechanism on an isolated restored copy first. Accept only
   the two exact recorded/current hash pairs in the table above, bound to this
   database identity and this reviewed prefix. Retain the existing narrowly
   proven 0058 format compatibility.
3. Record a separate auditable baseline decision, evidence digests and reason;
   preserve every original migration row and every published SQL file. No global
   allowlist, generic whitespace normalization, force switch, database reset,
   or replacement of recorded hashes is proposed.
4. Verify that status accepts this explicit development baseline, future drift
   still fails, other databases cannot inherit the exception, and upgrades and
   normal application behavior succeed on the isolated copy before enabling it
   for this development database.

The user subsequently approved this proposal. It was implemented and applied
using a new verified checkpoint and its still-open exported snapshot:
`artifacts/local-recovery/calmboard_recovery_19872_652e2885d0994ecd`.
The isolated restore matched 92 tables and 37,337 rows. Ordinary authentication
activity had made the older saved checkpoint differ from current session data;
the strict dry run rejected that stale comparison without writing metadata.
The fresh process preserves a consistent data snapshot and independently checks
the latest committed migration history/catalog under the advisory lock.

One database-bound decision is now stored in
`drizzle.__calmboard_development_baseline`; the 67 original history rows and the
public catalog are unchanged. Status and migrate both succeed with zero pending
or executed migrations. The decision and post-checks are exported locally in
`artifacts/baseline-live-decision-2026-11-05.json`. The uncertainty about the
missing SQL remains documented and no production exception is authorized.
