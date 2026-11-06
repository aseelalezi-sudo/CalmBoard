# ADR 0029 — Verified and serialized migration execution

Date: 2026-11-05. Status: accepted. Existing-database reconciliation is tracked
separately in [the history review](../migration-history-review-2026-11-05.md).

## Decision

`pnpm db:migrate` and the production Migrator image use the same Node runner,
`scripts/migration-runner.mjs`, through `scripts/database-command.mjs`. Direct
`drizzle-kit migrate` is outside the supported deployment contract. Drizzle
remains the schema/migration generator and snapshot checker.

Before connecting, the runner loads every journal entry and SQL file. It validates
contiguous indexes, safe index-prefixed filenames, unique positive timestamps,
nonempty UTF-8 SQL and supported journal format. It retains one in-memory snapshot
of each file's exact-byte SHA-256 and SQL statements.

The journal index defines execution order. Published `0052` has a timestamp lower
than `0051`; that exact historical pair is explicitly recognized without editing
either journal entry or SQL. Other non-advancing timestamps are rejected. Applied
entries must form a complete journal prefix; missing entries inside applied history
require investigation rather than automatic adoption or out-of-order replay.

## Connection and lock lifetime

One dedicated PostgreSQL Client holds the session advisory lock `(0x43414c4d,
0x4d494752)` for the target database. The lock covers reading history, validating
hashes, initial journal creation, and all pending migrations. A waiting migrator
rereads history after acquiring the lock.

`MIGRATION_LOCK_TIMEOUT_MS` defaults to 60000 and accepts 1–600000. PostgreSQL's
lock_timeout bounds lock acquisition; its previous session value is restored
afterward. The lock is explicitly released on the same connection, which is
closed in a finally block even on error. All deployment writers must use this
runner; advisory locks do not coordinate an unrelated tool that ignores them.

## History integrity and transactions

Every recorded timestamp must identify a known migration, each entry must be
unique, and every hash must match. Duplicate/unknown records, missing prefix
entries, changed applied files and untracked public tables fail before any
pending migration or automatic baseline adoption.

One reviewed format-only legacy hash is accepted for `0058`, pinned to both the
recovered original and current hashes. It is documented in the history review and
regression-tested. SQL whitespace is not normalized generically. This compatibility
entry never rewrites the existing journal hash or accepts another changed file.

Initial journal creation is transactional. Each pending migration and its journal
insert share a transaction. Failure rolls back that migration, keeps earlier
successful migrations recorded, releases the lock, and permits a later retry.
Migration files remain reviewed, trusted, transaction-compatible SQL.

`pnpm db:migrate:status` takes the same lock and verifies the same history, but
does not create metadata tables or execute SQL migration files. It exits nonzero
when verification fails. There is no force/re-hash/ignore-drift switch.

Hash verification checks migration history, not whether somebody later changed
the live schema manually. Schema/behavior integration checks remain necessary.

## Deployment and verification

The Migrator image contains the production database dependencies, SQL files and
runner scripts, uses a non-root account and dumb-init, and executes the shared
runner. CI builds/scans it alongside Web, API and Worker and runs isolated migration
tests with its own disposable PostgreSQL databases.

Tests cover concurrent bootstrap, lock timeout/release, rollback/resume, applied
file changes, read-only status, refusal to adopt an untracked schema, a real
`0051 -> 0052 -> 0066` upgrade, and the production CLI on an empty database.

No existing migration SQL or published timestamp was changed for this decision.

Subsequent local-only decision: [ADR 0030](./0030-explicit-development-migration-baseline.md)
adds an explicitly approved, database-bound development baseline for two missing
historical originals. Ordinary migrate/status never create it automatically;
production and Staging refuse that development decision. Original history stays
intact and unrelated drift remains rejected.
