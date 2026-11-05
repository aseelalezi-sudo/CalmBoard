# ADR 0028 — Actor-owned atomic comment reactions

Date: 2026-11-04. Status: accepted.

## Problem

`comments.reactions` historically stores emoji keys with arrays of display names.
Names are neither unique nor stable. Accepting a complete replacement map allows
impersonating reactors and overwriting concurrent updates. Historical strings
cannot be safely mapped to accounts, even if a string happens to match a UUID.

## Decision

Keep the existing JSONB column and preserve every historical string. Newly
verified reactions use an explicitly tagged JSON object:

```json
{ "👍": ["Historical name", { "userId": "authenticated-user-uuid" }] }
```

No table, column, backfill, or DDL migration is required. Drizzle's `$type` records
the new JSON value type without changing the SQL schema. Unknown historical
names are never assigned to an account by inference.

Repository/API reads project this representation into two maps:

- `reactions`: historical display names, preserved for compatibility.
- `reactionUserIds`: verified account IDs, deduplicated per emoji.

The UI derives active state exclusively from the current user's verified ID.
The displayed count includes historical entries and verified IDs; a tooltip
identifies historical counts. Historical entries cannot be claimed or removed
by selecting an account with the same name.

`POST /comments/reactions` accepts `organizationId`, `workspaceId`, comment `id`,
one supported `emoji`, and boolean `active`. The actor comes from the authenticated
request, never a body-supplied identity. An Idempotency-Key is required and its
request hash includes the authenticated actor. This is a set operation, not a
toggle: repeated adds/removes cannot invert state.

The repository checks active membership/permission in the comment's actual
project. The HTTP scope resolver also derives that project from the comment,
including reply parents and existing comment mutations. Foreign tenants,
workspaces, deleted resources, and conflicting project claims fail closed.

One SQL UPDATE computes the JSONB addition/removal from the row's current value;
PostgreSQL row locking serializes concurrent updates. Only the authenticated
actor's tagged object is added/removed. Whole-map replacement is rejected by
both the generic PATCH controller and the repository update boundary.

## Consequences

Existing RLS, tenant constraints, organization exports and organization deletion
continue to apply to the same comments row. Exports retain the tagged JSON form;
consumers must handle historical strings and verified objects. Account IDs retain
the same anonymized-principal lifecycle used for authored collaboration content.

A historical string and a verified object might represent the same person, but
that cannot be proven. Their counts remain separate rather than inventing an
identity or deleting historical data.

Old clients using whole-map writes must refresh to the updated client. A rollback
must retain the actor-scoped write contract; restoring an API that allows bulk
replacement would restore the concurrency and identity vulnerabilities.

A relational reaction table remains an option if per-reactor reporting or
high-volume independent-row writes become necessary. The existing bounded emoji
palette and atomic update suffice for the current product without adding a new
table, migration chain entry, tenant policy or purge/export domain.

## Verification

Real PostgreSQL tests exercise identical names, concurrent adds/removals,
idempotent repeats, rename persistence, legacy preservation, forged body actor,
replay after a later removal, viewer/revoked users, project overrides, foreign
tenant/workspace IDs and deleted comments. Client tests verify ID-based active
state and canonical acknowledgements. Chromium exercises adding/removing a
reaction and restoring its active state after reopening the task.
