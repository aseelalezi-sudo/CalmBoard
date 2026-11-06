# Local development database checkpoint

This Windows-only tool creates an encrypted PostgreSQL checkpoint and immediately
restores it into a randomly named disposable database. It is intended for local
development repairs. Production recovery continues to use `deploy/backup.sh` and
the offsite restore drill in `deploy/README.md`.

## Run

With the local PostgreSQL Compose container running and the root `.env` configured:

```powershell
docker build --file docker/db-recovery.Dockerfile --tag calmboard-db-recovery:local .
pnpm db:backup:local
```

The configured database must be on localhost. The source role needs complete read
access, RLS bypass, `pg_control_system()` access, and permission to create and drop
the isolated verification database. No privileges are granted by this tool.
The default container is `calmboard-postgres-1`; override it with
`LOCAL_RECOVERY_POSTGRES_CONTAINER`. `LOCAL_RECOVERY_IMAGE` selects a prebuilt
image; the tool pins its immutable local ID and never pulls an image while using
the recovery identity.

Output is under the ignored `artifacts/local-recovery/calmboard_recovery_*` directory:

- `database.dump.age`: standard age-encrypted PostgreSQL custom-format archive.
- `identity.dpapi`: age identity protected by Windows DPAPI CurrentUser.
- `receipt.json`: source cluster/database identity, exact migration history and
  checkout hashes, encrypted archive checksum, per-table row counts/digests,
  and the result of the restore comparison. It contains no row contents or passwords.
- `receipt.hmac`: keyed authentication of the receipt using the recovery identity
  and a dedicated receipt context.

Check the saved checkpoint later:

```powershell
pnpm db:backup:local --verify artifacts/local-recovery/<checkpoint-directory>
```

This checks DPAPI access to the original identity, authenticates the receipt, and
checks the archive checksum. It does not perform a second restore; the initial
command performed the restore drill recorded in the authenticated receipt.

## Verification and limits

The dump uses an exported repeatable-read snapshot. Source row fingerprints are
read from that same snapshot, preventing ordinary concurrent application writes
from making the comparison inconsistent. All non-system ordinary tables and
materialized views are compared with their restored contents using canonical
JSONB rows sorted with the C collation, including duplicate rows and the migration
history. A bounded cursor limits client memory. Restores use a single transaction
and stop on the first error. The tool creates its own uniquely named database;
it never accepts an existing restore target or changes source migration records.

The archive is streamed directly into age encryption. During the restore drill,
the private identity exists in process memory and a network-disabled container's
tmpfs; neither the plaintext dump nor the plaintext identity is written to a host
file. Temporary Docker environment files contain connection credentials and are
removed in normal success/failure cleanup. The isolated database is also removed.
An abrupt OS/process termination can leave temporary resources; investigate any
remaining `calmboard_recovery_*` database before deleting it. Never target the
application database when cleaning up.

DPAPI recovery depends on the original Windows user/profile and its keys. Copying
these four files to another machine is not an independently recoverable offsite
backup. Preserve the Windows recovery environment; use the production backup
procedure for portable disaster recovery. No copy is uploaded by this tool.

The archive is database-only. It does not back up MinIO objects, Redis, environment
secrets or cluster roles. The test restore omits ownership and ACL replay, and row
comparison does not prove all historical migration data transformations. Sequence
values are not MVCC snapshot data and are not compared under concurrent writes.
This local exercise does not close the production backup/recovery release gates.

## Verified checkpoint on 2026-11-05

Checkpoint: `calmboard_recovery_9188_69b8dfb8ad3b479f`.

The isolated restore matched **92 tables / 37,336 rows**, including all **67**
historical migration records. The original 0040, 0041 and 0058 recorded hashes
were preserved. Both changing the receipt and corrupting a copied encrypted
archive were detected by subsequent verification. Test copies were deleted;
the original checkpoint remains local. Application development servers were
left running.

This provides recovery evidence for the proposed development baseline review in
[migration-history-review-2026-11-05.md](./migration-history-review-2026-11-05.md).

The later user-approved adoption used a fresh checkpoint,
`calmboard_recovery_19872_652e2885d0994ecd`, with **92 tables / 37,337 rows**.
It kept the exported source snapshot open through restore verification and the
locked baseline decision, allowing normal application writes to continue. See
[ADR 0030](./adr/0030-explicit-development-migration-baseline.md). A later backup
of the adopted database includes its baseline metadata too; that decision cannot
be inherited automatically by a restored database with a different identity.
