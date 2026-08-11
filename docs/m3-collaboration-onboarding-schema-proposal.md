# CalmBoard M3 — Collaboration & Onboarding Final Report

Status: **COMPLETE — STOPPED BEFORE M4**

## 0061 Migration

- Exact SQL path: `packages/database/migrations/0061_m3_collaboration_onboarding.sql`.
- Snapshot: `packages/database/migrations/meta/0061_snapshot.json`.
- Journal: `packages/database/migrations/meta/_journal.json`, entry `idx: 61`, tag `0061_m3_collaboration_onboarding`.
- SQL scope is limited to the approved invitation extensions, invitation email outbox, comment mentions, notification deduplication/safe path, onboarding progress, their constraints/indexes/FKs, and forced tenant RLS for the three new tables.
- The migration was generated through the native Drizzle workflow, inspected, pristine-verified, and applied to Development with the official migration runner.
- Migrations `0057` through `0060` were not edited. No migration after `0061` was created.

## Invitations Schema

- The existing `invitations` table was extended; no parallel invitation system was created.
- Added `tokenHash`, `tokenVersion`, `expiresAt`, `acceptedAt`, `acceptedBy`, `revokedAt`, `declinedAt`, `lastSentAt`, and `updatedAt`.
- New tokens contain 32 cryptographically random bytes. Only their SHA-256 hash is stored in `invitations`.
- `tokenHash` is unique when non-null, token/hash expiry pairing is constrained, and terminal timestamps cannot overlap.
- New invitations start at token version 1. Resend locks the row, rotates the token/hash, increments the version, resets expiry, and enqueues the matching email generation atomically.
- Legacy pending rows remain at version 0 with null token/expiry and are exposed as `resend_required`; no tokens were manufactured for them.

## Invitation Outbox

- Added tenant-scoped `invitation_email_outbox`, with one durable job per `(invitationId, tokenVersion)` and a unique provider idempotency key.
- The acceptance payload is encrypted using the existing AES-256-GCM keyring and identity-bound AAD. No reusable raw token is stored in the invitation row or plaintext outbox columns.
- The worker claims with `FOR UPDATE SKIP LOCKED`, recovers abandoned claims, applies exponential retry/backoff, and preserves the invitation on provider failure.
- Before delivery it verifies pending status, matching token version/recipient, and unexpired state. Stale generations are skipped.
- Ciphertext, IV, and authentication tag are scrubbed after successful or stale delivery. Provider calls use a stable outbox-ID idempotency header.

## Comment Mentions

- Added `comment_mentions` as the authoritative identity relation with tenant, project, task, comment, and mentioned-user scope.
- `(commentId, mentionedUserId)` is unique; repeated textual mentions create one relation/event.
- Eligible users are resolved only from active organization/workspace membership; self and foreign-tenant mentions are rejected/excluded.
- Editing diffs the before/after identity sets: new mentions notify, unchanged mentions do not, removed mentions are deleted without notification.
- Soft deletion removes active mention relations. The table uses forced RLS and the normal tenant policy.

## Notifications

- Extended the existing `notifications` table with `deduplicationKey` and `actionPath`.
- Logical event keys are server-generated and stable. A partial unique index covers organization, recipient, and non-null deduplication key.
- `actionPath` accepts only internal app-relative paths; absolute and protocol-relative targets fail a database check.
- Mention, reply, and invitation-accepted notifications have safe task/comment or members targets.
- In-app and email delivery honor the existing `inAppEnabled` and `emailEnabled` preferences. Notification email jobs reuse the logical event identity.
- Header dropdown and Inbox both mark/read/open supported targets; authorization still runs when the target resource loads.

## Onboarding

- Added `user_onboarding_progress`, scoped uniquely to user + workspace and tenant-bound by organization/workspace.
- Allowed steps are server-owned: `workspace_ready`, `project_created`, `task_created`, `teammate_invited`, and `board_explored`.
- Workspace/project/task/invitation milestones are derived from real persisted state; arbitrary client step IDs are rejected.
- The API takes actor identity from the authenticated session and the repository enforces self-only reads/writes.
- The responsive checklist supports dismiss/resume and cross-device persistence. Project/task/invite actions pass through the normal permission gates.
- The table uses ENABLE/FORCE RLS with the project tenant policy.

## Migration Verification

- Native Drizzle schema check: passed.
- Pristine chain `0000` through `0061`: passed with 86 tables and 62 migration entries.
- Pristine verification suites: database integration 37/37, automation/form/billing workers 10/10, scheduled reports 3/3, workspace exports 3/3.
- Development application: passed through `pnpm run db:migrate`.
- Current-development verification: passed with 86 tables / 62 migrations, database integration 33/33, and API integration 10/10 at application time.
- Post-implementation database integration: 34/34 passed.
- PostgreSQL tests physically verify token-hash uniqueness, invitation/version outbox uniqueness, mention uniqueness, notification deduplication and safe paths, onboarding uniqueness, and cross-tenant visibility for all three new RLS tables.

## M3.1 Invitations

- Manager lifecycle: create, list pending/effective state, resend, and revoke.
- Invitee lifecycle: public token inspection plus authenticated matching-email accept/decline.
- Acceptance locks the invitation inside the tenant transaction, validates token/status/expiry/identity, creates or confirms one membership, transitions the invitation, and records notification/activity atomically.
- Concurrent acceptance test proves one success, one terminal rejection, and exactly one membership.
- The acceptance page includes invalid, expired, revoked, accepted, and declined states plus embedded sign-in/register flow and bidi-safe email display.
- Sensitive invitation endpoints have fail-closed distributed rate-limit rules.

## M3.2 Mentions

- Added a bounded server resolver for active eligible members.
- The composer and inline editor support server-backed `@` search, keyboard selection, and structured `@[name]` display markers while sending trusted user IDs separately.
- Create/edit mutation, mention relations, in-app notification, email outbox, and automation event share one transaction. A PostgreSQL test exposed and verified the fix for this boundary.
- Tests cover duplicate names, self/foreign recipients, unchanged/removed/re-added mentions, deduplication, and deletion cleanup.

## M3.3 Replies

- Replies are limited to one level. Parent validation requires the same organization, workspace, project, task, active task, and non-deleted top-level comment.
- Cross-task parents and replies-to-replies are rejected.
- Thread UI renders top-level comments with one indented reply level.
- Parent authors receive one reply notification; self replies are excluded, and an explicit mention prevents a duplicate reason for the same mutation.
- Edit/delete controls follow author ownership; owner/admin moderation and pinning are explicit in repository and UI behavior.

## M3.4 Notifications

- Stable logical deduplication is database enforced across in-app notifications and durable email enqueueing.
- Existing global channel preferences are honored; granular event preferences and Push remain deferred.
- Task/comment and members deep links are internal-only and Inbox/header navigation is functional.
- Invitation email failures retry independently of invitation existence; delayed old resend generations cannot send stale links.

## M3.5 Onboarding

- The checklist represents the shortest workspace journey: workspace, first project, first task, first teammate invitation, and board exploration.
- Dismiss/resume is persisted, and completion is derived/recorded across devices.
- Server allow-list and authenticated self-ownership are covered by PostgreSQL integration tests.
- Browser visual QA was not available because the environment reported no connected/default browser. No visual-browser pass is claimed; code-level responsive, dark-mode, RTL, accessibility, TypeScript, lint, and production-build gates passed.

## Full Gates

- `pnpm run ci`: passed end-to-end.
- Environment, tracked-secret, UTF-8/mojibake, Drizzle schema, and circular-dependency checks: passed.
- Typecheck: 10/10 packages passed.
- Lint: 10/10 packages passed.
- Format check: passed.
- API unit tests: 150/150 passed.
- Web unit tests: 85/85 passed.
- Worker tests: 49 passed, 9 environment-dependent integration cases skipped, 0 failed.
- Database PostgreSQL integration: 34/34 passed.
- Production build: 10/10 packages passed; `/accept-invitation` is included in the generated Next.js routes.
- `git diff --check`: passed.
- The production build emits only Node's upstream `module.register()` deprecation warning from the Next.js toolchain; it is non-blocking and not an application failure.

## Database

- New migration created: **YES — `0061_m3_collaboration_onboarding` only**.
- `0061` applied to Development: **YES**.
- Migration after `0061` created: **NO**.
- Backfill executed: **NO**.

## Deferred

- M4 Data Lifecycle / SaaS Operations.
- Burnup and advanced Capacity Planning.
- Legacy collaboration/onboarding backfill.
- Granular per-event notification preferences and Push.
- P2/P3 features including chat, video, collaborative text editing, advanced presence, infinite comment nesting, SSO/SCIM, and enterprise provisioning.

**STOP: M4 has not been started.**
