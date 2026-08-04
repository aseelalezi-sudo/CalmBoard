# Pre-baseline SQL archive

These SQL files predate the Drizzle migration journal. They are retained for historical review and for assessing upgrades of databases created before the baseline.

They are not read by `pnpm db:migrate` and must not be executed automatically in staging or production. The official migration chain starts at `../migrations/0000_baseline.sql`; any still-relevant constraint from this archive must be represented in the Drizzle schema and generated as a journaled migration.
