# ADR 0021: Resource-scoped document access, hierarchy, and versions

- Status: Accepted
- Date: 2026-07-30

## Context

Workspace document reads previously returned every active document to every member. Mutations relied only on the broad `documents.manage` permission, accepted author and version-saver identities from request bodies, and had no per-document grants. `parent_id` had no foreign key, cycle prevention, tenant validation, or depth limit. Snapshot numbering used the number of rows already present, so concurrent saves could allocate the same version.

## Decision

Documents keep the existing workspace permission for creation and backward-compatible management, then apply a resource ACL for every read and mutation. The authenticated author is an implicit manager. Explicit grants support `viewer`, `editor`, and `manager`; workspace visibility supports `none`, `viewer`, and `editor`. Child pages may inherit the strongest access available from their parent. Existing documents default to workspace viewer access, while users who already hold `documents.manage` retain manager access.

The API derives authors and snapshot savers exclusively from the authenticated session. It returns an effective `accessLevel` with each visible document, and the web application uses that value for editor and management controls. Permission targets must be active workspace members. Only document managers can change hierarchy, workspace visibility, inheritance, public visibility, or individual grants.

The hierarchy is limited to ten levels. The repository rejects self-parenting, cycles, inaccessible parents, and moves that would make an existing subtree too deep. A self-referencing foreign key, check, tenant-scope trigger, and hierarchy trigger provide database-level defense.

Snapshot creation locks the document row, derives content from the stored document, selects the next version number inside the transaction, and relies on a unique `(doc_id, version_number)` index. Restore first saves the current state as a new snapshot, making every restore reversible. Version reads require viewer access; snapshot and restore require editor access.

Public documents are exposed only through a dedicated read-only route that selects the document identifier, title, content, icon, and update time. A separate RLS select policy admits only active rows explicitly marked public.

## Consequences

- Private and individually shared documents can coexist with the existing workspace knowledge base.
- Nested pages inherit access predictably without allowing cycles or unbounded depth.
- Client-supplied user identifiers cannot impersonate an author or version saver.
- Concurrent snapshot creation is serialized and version numbers are unique.
- Restoring an old version never destroys the state that existed immediately before restoration.
- Global document managers continue to manage existing documents; removing that compatibility requires a separate role-policy migration.
