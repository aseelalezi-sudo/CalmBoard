# CalmBoard M2 — Authorization & Arabic Quality Gate

Status: **IMPLEMENTATION AND AUTOMATED GATES COMPLETE — MANUAL VISUAL SIGN-OFF PENDING**

M2 is stopped here. M3 has not started.

## Baseline

- M1 reference commit: `084e8f10de5015f4cc306b18d9aa0b13c6a4d729` (`fix(web): hide incomplete feature previews`, 2026-08-05).
- The Sprint, Analytics, migration, and migration-snapshot files required by M1 were present before M2 work started.
- The intended M1 release files were reviewed and staged individually. `git add .` was not used.
- Temporary verification files (`kill.js`, `search.js`, `test_drizzle.ts`, `verify-0059.js`, `verify-0060.js`, `verify-analytics-capture.ts`, and `diff-utf8.txt`) were absent.
- The worktree already contained the approved M1 changes. M2 preserved them and did not reopen their implementation.

## Authorization Root Cause

The original `TenantGuard` resolved organization and workspace identifiers from the request but did not reliably include Project scope:

- `:projectId` route parameters were not part of the authorization scope.
- Task routes addressed by `:id` could authorize only at workspace scope even though the persisted Task belongs to a Project.
- Nested Sprint/Task identifiers were not compared with the route Project before permission resolution.
- Realtime access resolved tenant membership before deriving the actual Project from a Task.

This allowed Project-level role bindings and permission overrides to be omitted from otherwise valid authorization decisions. Repositories still applied tenant predicates, but repository isolation is not a replacement for resolving the correct RBAC scope.

## Final Scope Resolution

The final HTTP flow is:

1. Read organization, workspace, and Project identifiers from canonical route parameters plus supported body/query fields.
2. Reject conflicting identifiers with HTTP 400.
3. Collect nested Task, Sprint, checklist-item, and approval-request identifiers.
4. Resolve their persisted Project under the supplied organization/workspace database context.
5. Return not-found for inaccessible cross-workspace/cross-organization resources or resources spanning multiple Projects.
6. Reject a route Project that conflicts with the persisted resource Project.
7. Resolve authorization using the canonical organization/workspace/Project scope.
8. Attach only the trusted scope and resulting database-backed authorization decision to the request.
9. Let `PermissionGuard` enforce the declared permission. Frontend visibility remains UX only.

Actor-like body/query fields continue to be replaced with the authenticated identity. Platform administration remains an explicit, separate policy and does not bypass ordinary tenant membership.

Realtime access now derives and validates Workspace/Task/Project relationships before resolving membership and Project-scoped roles.

## Project RBAC

The real-database integration matrix proves:

| Role/scenario                                     | Project A                 | Project B                 | Result |
| ------------------------------------------------- | ------------------------- | ------------------------- | ------ |
| Member with `tasks.update` Project deny in A      | denied                    | allowed                   | PASS   |
| Viewer with Project allow for `tasks.update` in A | allowed                   | denied by default         | PASS   |
| Admin with `sprints.view` Project deny in A       | analytics denied          | analytics allowed         | PASS   |
| Platform admin without organization membership    | no implicit tenant access | no implicit tenant access | PASS   |

The UI now hides Sprint and Active Sprint navigation unless `sprints.view` is present. Existing mutation controls continue to use their specific permissions (`sprints.manage`, `tasks.update`, `projects.update`, and others). Backend authorization remains authoritative.

## Nested Resource Protection

- Project A + Sprint from Project B: **BLOCKED**.
- Project A + Task from another Project: **BLOCKED** by trusted resource derivation/conflict handling.
- Task in another Workspace of the same organization: **BLOCKED**.
- Task in another organization: **BLOCKED**.
- Sprint Analytics UUID under the denied Project: **BLOCKED**.
- Task-ID-only routes derive the Task's actual Project before permission resolution: **VERIFIED**.
- Multiple nested Sprint/Task identifiers spanning Projects: **BLOCKED**.

## RLS

- Restricted-runtime PostgreSQL RLS integration test: **PASS**.
- Full database integration suite: **33/33 PASS**.
- API integration suite, including Project authorization and realtime isolation: **10/10 PASS**.
- Current-database migration verification reapplied all 61 migrations to a copy, preserved the source database, and passed database/API integration tests.
- Empty-database verification created 83 tables from 61 migrations, ran RLS/integrity tests, and now explicitly includes the M2 Project authorization test.

## Arabic Inventory

A read-only UTF-8/mojibake scan now covers user-facing TypeScript, TSX, JavaScript, JSON, and Markdown under:

- `apps/web/src`
- `apps/api/src`
- `packages/notifications/src`

It detects replacement characters, common Latin-1/Windows punctuation corruption, repeated CP1256-style Arabic UTF-8 corruption, and UTF-8 BOM inconsistencies. The rule was tested against representative corrupt input and reviewed against false positives such as the valid phrase `جارٍ الحفظ…`.

Final high-impact mojibake inventory: **ZERO**.

The source metadata in `apps/web/src/app/layout.tsx` is valid UTF-8 Arabic. No M2 bulk replacement was performed and no automatic rewrite behavior was added.

## Localization

The established CalmBoard vocabulary was retained:

| Concept                         | Arabic term                   |
| ------------------------------- | ----------------------------- |
| Organization                    | المؤسسة                       |
| Workspace                       | مساحة العمل                   |
| Project                         | المشروع                       |
| Task / Subtask                  | المهمة / المهمة الفرعية       |
| Board / List / Calendar         | اللوحة / القائمة / التقويم    |
| Timeline                        | المخطط الزمني                 |
| Sprint / Active Sprint          | السبرنت / السبرنت النشط       |
| Backlog                         | التراكم                       |
| Reports                         | التقارير                      |
| Velocity / Throughput           | السرعة / الإنتاجية            |
| Burndown                        | مخطط الإنجاز                  |
| Members / Settings              | الأعضاء / الإعدادات           |
| Notifications / Search          | الإشعارات / البحث             |
| Automations / Documents / Forms | الأتمتة / المستندات / النماذج |
| Time Tracking                   | تتبع الوقت                    |

The Sprint error, loading, empty, validation, confirmation, and toast copy was reviewed as UTF-8 and uses the same Sprint/Backlog vocabulary.

Hardcoded bilingual `ctx.t(ar, en)` pairs remain duplicated across components. A large localization-framework rewrite was deliberately deferred because M2 requires a bounded repair, not a framework migration.

## RTL

- Arabic continues to set `lang="ar"` and `dir="rtl"`; English sets `dir="ltr"` through the existing preference store/bootstrap.
- Velocity and Burndown plotting areas explicitly use LTR chronology so RTL document direction cannot reverse historical meaning.
- Arabic tooltips inside those LTR plotting areas restore RTL text direction.
- Sprint dates now use `ar-SA` or `en-US` explicitly rather than the host's unspecified locale.
- Net Scope Change uses locale-aware sign formatting and `<bdi dir="ltr">`, keeping `+8` and `-3` attached to their values.
- Positive signs are limited to Net Scope Change; commitment, final scope, completed, and remaining values are unsigned counts.
- Story Points labels in the summary are localized (`نقطة` / `pts`).
- No directional Sprint icon required mirroring; the audited Sprint tab icons are semantic, not back/forward controls.

## Visual QA

The web application responded at `http://localhost:3000`, and the built API health endpoint responded HTTP 200 at `http://localhost:5500/health`. PostgreSQL, Redis, and MinIO were healthy.

The in-app browser runtime reported no available browser sessions after its documented recovery check. Therefore no screenshot or viewport result is claimed.

Manual visual sign-off remains required for this matrix:

| Locale      | Theme          | Viewports             | Screens                                                                                                                  |
| ----------- | -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Arabic RTL  | Light and Dark | 1440×900 and 1024×768 | Dashboard, Project, Task detail, Sprints/Backlog, Active Sprint, Reports (Overview/Velocity/Burndown), Settings/Security |
| English LTR | Light and Dark | 1440×900 and 1024×768 | Same shell/navigation and Sprint/Reports sanity paths                                                                    |

For each cell verify broken glyphs, overflow, dropdowns, dialogs, tables, tabs, directional icons, Arabic title + English username/email, UUID/code, dates, Story Points, URLs, chronological order, and attached numeric signs.

Automated RTL/Arabic evidence is available, but the M2 visual gate must remain pending until this manual matrix is signed off.

## Tests

- Encoding regression tests: **3/3 PASS**.
- New navigation visibility tests: **2/2 PASS**.
- Sprint presentation/sign test: **PASS**.
- API unit suite: **150/150 PASS**.
- Web unit suite: **85/85 PASS**.
- Script tests: **18/18 PASS**.
- Full database integration: **33/33 PASS**.
- Full API integration: **10/10 PASS**.
- Empty-database selective integration after adding M2: **37/37 PASS** plus worker suites.
- Real Project authorization integration covers Viewer, Member, Admin, Platform Admin, two Projects, two Workspaces, and two organizations.

## Full Gates

- Environment validation: **PASS**.
- Tracked secret scan: **PASS**.
- User-facing encoding scan: **PASS**.
- Drizzle schema/migration consistency: **PASS**.
- Circular-dependency scan (521 source files): **PASS**.
- Route type generation: **PASS**.
- Typecheck (10 packages): **PASS**.
- Lint (10 packages): **PASS**.
- Prettier: **PASS**.
- Unit/regression tests: **PASS**.
- Integration tests: **PASS**.
- Production build (10 packages): **PASS**.
- Current migration verification: **PASS**.
- Empty migration verification: **PASS**.
- `git diff --check` and `git diff --cached --check`: **PASS**.

## Database

- Schema change required by M2: **NO**.
- Migration required by M2: **NO**.
- Backfill required by M2: **NO**.

All Sprint schema and migrations shown in the worktree are approved M1 artifacts that existed before M2 began.

## Deferred

1. Manual browser visual sign-off for the documented locale/theme/viewport matrix.
2. Consolidation of repeated `ctx.t(ar, en)` literals into a translation catalog; this is technical debt and was intentionally not expanded into M2.
3. Unrelated P2/P3 audit findings remain governed by `docs/full-product-audit.md` and were not implemented here.

No M3 work is included in this report.
