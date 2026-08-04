# ADR 0018: Versioned, owner-scoped saved views

- Status: Accepted
- Date: 2026-07-29

## Context

Saved views stored only a name, view type, and unbounded filter JSON. Private views were visible to every workspace member, the creating user was accepted from client input, and there was no update or default-view lifecycle. The advanced task table also kept sorting, column visibility, order, pinning, and sizing only in component memory, so a column drag or resize could not be restored.

## Decision

Each saved view is tenant and project scoped and is owned by the authenticated actor. Repository reads return only shared views or views owned by that actor. Only the owner may update or soft-delete a view. Creation never accepts ownership from the client.

Persisted configuration uses an explicit `schemaVersion: 1`. Table views may store bounded sorting, column visibility, order, pinning, and sizing state. API validation allow-lists every filter and column identifier, rejects unknown fields, limits sorting depth, and bounds column sizes. The web store normalizes persisted state so removed columns are ignored and newly introduced columns are restored in the canonical order.

One partial unique index permits at most one active default view for each organization, workspace, project, and owner. Default replacement is transactional. Database checks require object-shaped filters, configuration version 1, valid view types, and a project and owner for default views. A trigger validates workspace, project, and active owner-membership scope; existing forced row-level security remains in effect.

## Consequences

- Private view state is no longer disclosed to other workspace members.
- Column drag, resize, order, pinning, visibility, and sorting can be restored through a saved table view.
- Configuration evolution has an explicit version boundary instead of relying on arbitrary JSON.
- Shared views are readable by peers but remain editable and deletable only by their creator.
- A future configuration version requires an explicit validator and migration or compatibility path.
