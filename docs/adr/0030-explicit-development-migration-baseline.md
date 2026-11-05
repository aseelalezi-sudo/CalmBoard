# ADR 0030: Explicit, database-bound development migration baseline

Date: 2026-11-05. Status: accepted for the approved local development database.

## Decision and evidence

The user explicitly approved accepting the current development database as a
baseline after the original SQL for migrations 0040 and 0041 could not be
recovered. Their historical effects remain unproven. This decision preserves
that uncertainty and all original recorded hashes; it does not assert that the
missing SQL matched the checkout.

The approved adoption created one row in
`drizzle.__calmboard_development_baseline`, separately from Drizzle's original
history. It records cluster system identifier, database OID/name, approval time
and reason, the pinned first-67-file manifest digest, the exact original history
digest, two exact historical/current hash pairs, and checkpoint/catalog evidence.
Inherited non-owner grants are revoked from the decision table. Modifying its
contents requires the trusted metadata owner or an administrator.

The reader accepts the two pairs only after validating that document and its
digest, this exact database identity, the unchanged reviewed file prefix, and
all original prefix history records. New migrations can be appended normally.
Changed old files, altered history, unknown entries and gaps remain errors.
An unchanged decision copied to another database is refused. Production and
Staging refuse this development decision, even if its database identity matches.
There is no environment flag that globally permits unknown hashes.

The original exact-format compatibility for 0058 remains separately supported
by the recovered original artifact described in the history review. No published
SQL file or journal timestamp was changed by this decision.

## Adoption procedure

`pnpm db:baseline:dev` is a separate Windows/local operator command. It is not part
of application startup, ordinary migration execution, or production images.

```powershell
# Verify a proposed decision without writing baseline metadata:
pnpm db:baseline:dev --fresh --reason "Documented approval and missing-originals rationale"

# Record an explicitly approved decision:
pnpm db:baseline:dev --fresh --reason "Documented approval and missing-originals rationale" --apply
```

`--fresh` creates an age-encrypted checkpoint and verifies a full isolated restore.
The exported source snapshot remains open until the decision finishes. Under the
same advisory lock used by the migrator, adoption checks the latest committed
history and public catalog, then imports that exported snapshot for the exact
source-versus-restored row comparison. This provides point-in-time data evidence
while ordinary session refreshes and other application writes continue. A newer
migration/schema change cannot be hidden by the imported data snapshot.

A saved authenticated checkpoint can instead be supplied with
`--checkpoint DIRECTORY --reason REASON [--apply]`; without a live exported
snapshot, current table contents must still match that checkpoint. It is useful
for a quiescent database and for repeating the same completed decision. Existing
decisions are never overwritten or silently replaced with new evidence.

Adoption requires the exact reviewed 67-file checkout, authenticated restore
evidence, matching source identity and full original history, and a fresh public
catalog comparison against an independently migrated reference. Only the two
exact previously reviewed function-definition pairs may differ in that catalog;
their definitions are pinned and tested. There is no generic SQL normalization.
No SQL migration is rerun and no business row is updated by adoption.

## Verification and limits

- 42 script tests, including database-bound validation and exact catalog pairs.
- Eight PostgreSQL integration tests, including concurrent adoption, wrong
  evidence/identity, protected environments, drift, unchanged history, owner-only
  metadata grants, exported snapshots with concurrent data writes, rejection of
  newer history, and an appended migration executed exactly once.
- The adoption scenarios also passed on an isolated restore of the real data;
  the goal integration test passed there. For this test, the fresh reference
  schema was also round-tripped through PostgreSQL backup/restore: reparsing
  `CHECK` array casts changes their catalog representation. The live adoption
  retained the strict comparison against the directly migrated reference.
- Production Migrator image built and applied/verified 67 migrations on a new
  disposable database, using the exact current runner/baseline module bytes.
- Live `db:migrate:status` and `db:migrate` succeeded with zero pending/executed
  migrations. All 67 original history rows and the public catalog were unchanged.

The final pre-adoption encrypted checkpoint is
`artifacts/local-recovery/calmboard_recovery_19872_652e2885d0994ecd`:
92 tables / 37,337 rows were verified against its source snapshot. The source
now additionally has the single baseline metadata row. Evidence and decision
export are kept locally under `artifacts/`; credentials and row contents are not
included in the decision document.

This closes the approved local development history issue. It does not recover
the missing SQL, authorize a production exception, verify historical data
transformations, or satisfy offsite/cluster/object-store recovery gates. A restored
copy has a new identity and cannot inherit this approval automatically. Trusted
administrators can change database metadata; this mechanism does not defend
against a malicious database owner. Ordinary status verification checks history
and files, not all subsequent manual schema/data changes.
