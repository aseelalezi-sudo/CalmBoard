# CalmBoard M5 — Staging / Beta / Release Candidate

Execution date: 2026-08-11 (Asia/Riyadh)

# Release Baseline

- Commit: `084e8f10de5015f4cc306b18d9aa0b13c6a4d729`.
- Baseline status: **FAIL**. The worktree is not a reproducible release candidate: 90 tracked files modified, 60 staged additions, 4 staged additions modified again, and 39 untracked files. Release-required M3/M4/M5 files are among the uncommitted files.
- Lockfile SHA-256: `3dfd6daec9c07aa3f4d7e13d4b9aa6e6ce8b4f524e10b22d4cff457121ff06dd`.
- No `.env` file is tracked. `.env.example` is the only tracked environment template.
- Images:
  - Web: `sha256:efb9a0d42e1d7e7d2d56153c4212fc357851762c19a86f3a11db1f7b1450de79`
  - API: `sha256:e653c1599d9c654f3c6085d91b7d12095b40f8309f38f670a055d1ccdcbae772`
  - Worker: `sha256:b1c70a6371445836bd19b154f98f046474895bb23355584257263c06759a8c27`
- SBOM artifacts were regenerated for all three images under `artifacts/`.
- Pinned Grype scan: 0 Critical, 0 High, 0 Medium, 0 Low findings for each image.

# Staging Deployment

**PARTIAL / NOT REPRESENTATIVE OF PRODUCTION.** A fresh, isolated Docker Compose project named `calmboard-m5-local` was created with new PostgreSQL, Redis, and MinIO volumes. Web, API, Worker, PostgreSQL, Redis, and MinIO reached healthy state. It is local staging only: no external ingress/TLS, real email provider, real scanner, Stripe Test account, remote backup destination, Sentry/Prometheus/on-call destination, or production secrets manager was available.

The disposable Compose project, its named volumes, synthetic tenant data, and its temporary environment file were removed after evidence collection. They are not recoverable; no development or customer database was targeted.

Production-style API startup was deliberately tested and failed closed (exit 1) for: missing auth secret, missing application DB URL, malformed Redis URL, disabled attachment scanner, and invalid trust-proxy hops. Development fallback secrets were rejected.

Configuration audit:

| Feature                          | Enabled locally      | Required configuration present                            | Operationally verified  | Production-ready          | Blocking |
| -------------------------------- | -------------------- | --------------------------------------------------------- | ----------------------- | ------------------------- | -------- |
| PostgreSQL                       | Yes                  | Synthetic staging values                                  | Yes                     | Not externally proven     | No       |
| Redis                            | Yes                  | Synthetic staging values                                  | Yes, including outage   | Not externally proven     | No       |
| MinIO/object storage             | Yes                  | Synthetic staging values                                  | Health only             | No                        | Yes      |
| Turnstile                        | Test keys            | Official test values                                      | Registration passed     | No real hostname/TLS test | Yes      |
| Email                            | Placeholder only     | No real provider                                          | No                      | No                        | Yes      |
| Attachment scanner               | Placeholder endpoint | No real scanner                                           | Fail-closed config only | No                        | Yes      |
| Stripe                           | No                   | Missing test secret/webhook                               | No                      | No                        | Yes      |
| OAuth providers                  | Disabled             | Optional credentials absent                               | No                      | Disabled                  | No       |
| AI provider                      | Disabled             | Optional credentials absent                               | No                      | Disabled                  | No       |
| Observability/alerts             | No external backend  | Missing destination/token configuration                   | Logs only               | No                        | Yes      |
| Backup encryption/remote storage | No                   | `age`, remote S3 credentials, and destination unavailable | No                      | No                        | Yes      |

# Fresh Migration

**PASS locally.** The production migrator applied the immutable chain `0000` through `0063` to an empty database. Verification: 64 journal/database migrations, 91 public tables, 77 RLS tables, 77 FORCE RLS tables, and 148 non-internal triggers. `db:check` passed. The migration runner was rerun idempotently during recovery and exited successfully.

# Authentication

**PARTIAL.** Public browser registration and session creation passed in Chromium and WebKit. Integration coverage passed for Argon2id registration/login/logout, refresh rotation/reuse revocation, MFA/TOTP/recovery codes, OAuth state/PKCE, and authentication email outbox. Full browser workflows for expiry, password reset, verification email, lockout, MFA UI, recovery codes, and session revocation were not completed against real providers.

# Core Work Management

**PARTIAL.** A real UI flow passed in Chromium and WebKit for creating an Organization/Workspace owner, switching Arabic to English, creating a Project, Task, Subtask and Comment, refreshing for persistence, and opening Board. The complete task/view matrix, rollback conflicts, attachments, recurrence, reminders, approvals, and all cross-view mutations were not exercised end to end.

# Sprints / Analytics

**PARTIAL.** Database and repository integration tests passed, including Sprint lifecycle, analytics and historical behavior covered by the repository suite. Full known-dataset comparison against API and browser reports was not completed.

# Collaboration

**PARTIAL.** Database integration passed for invitations, mentions, replies, deduplication and onboarding constraints. No real email delivery, two-session realtime browser validation, resend/cancel/expiry UI matrix, or retry delivery drill was completed.

# Attachments

**BLOCKED.** MinIO was healthy and unit/integration adapters are covered, but no actual staging malware scanner was available. The required upload/MIME/oversize/malware/unavailable-scanner/download/foreign-tenant/preview/cleanup E2E matrix was not completed.

# Organization Export

**PARTIAL.** `0063_export_scope` and format/idempotency integration tests passed. A real multi-Workspace organization archive with binaries, hashes, missing-object behavior, expiry and Worker-memory observation was not produced.

# Account / Organization Lifecycle

**PARTIAL.** `0062_data_lifecycle` integration passed all four lifecycle cases, including ownership, uniqueness/retry, RLS/write freeze, anonymized principal and non-PII receipt. Disposable-user UI flows and isolated purge-engine execution were not completed. Production organization purge remains disabled.

# Stripe Real Test Mode

**BLOCKED.** No Stripe Test secret or webhook secret/destination was available. The mandatory real provider lifecycle was not run; unit tests are not accepted as a substitute.

# Backup / Restore Drill

**BLOCKED.** The environment lacked `age`, remote S3/MinIO backup credentials/destination, and an approved staging backup set. No encrypted remote backup, isolated restore, object restore, failure drill, RPO measurement or RTO measurement was performed.

# Browser Visual QA

**BLOCKED.** No interactive in-app browser session was available. Automated Playwright passed 8/8 tests on Chromium and WebKit. Firefox failed 4/4 before page creation with an internal Playwright `browserContext.newPage` error even after reinstalling its matching binary. Required visual review across themes, widths, and the full screen list remains incomplete.

# RTL / Localization

**PARTIAL.** Arabic registration and the real language switch to English/LTR passed in Chromium and WebKit. Encoding scan passed across user-facing sources. The detailed RTL visual matrix, charts, timelines, dialogs, mixed identifiers, dates and signs was not manually approved.

# Accessibility

**PARTIAL.** Axe WCAG 2.1 A/AA smoke tests for Auth and API Reference passed on Chromium and WebKit. Firefox could not create a page. Authenticated screens, keyboard/focus/dialog/menu/combobox/destructive flows were not comprehensively tested.

# Security Smoke

**PARTIAL.** Secret and encoding scans passed. CSRF rejected a mutation without a token (403). CORS returned the configured origin for the allowed request and did not reflect a foreign origin. Web locally emitted `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`. CSP/HSTS and API security headers through a real TLS ingress were not verifiable. Registration rate limiting returned 429 during controlled repeated runs.

An RC-impacting log leak was found and fixed: request `cookie`, `authorization`, `x-csrf-token`, query tokens, and response cookies are no longer serialized. A live request carrying synthetic values produced `LOG_SECRET_LEAKS=NONE` after the rebuilt API image was deployed.

# RBAC / RLS / Tenant Isolation

**PARTIAL / STRONG INTEGRATION EVIDENCE.** The upgrade-copy suite passed database authorization, tenant isolation, project-scoped authorization, realtime tenant isolation and the M3/M4 RLS tests. Staging schema has RLS + FORCE RLS on all 77 protected tables. The explicit browser/API negative-ID matrix for every M5 entity and the full Owner/Admin/Member/Viewer UI matrix were not completed.

# Performance / Load

**PARTIAL / NOT A RELEASE LOAD TEST.** A local 200-request, concurrency-10 probe produced:

| Path                 | Errors |      p50 |      p95 |      p99 |   Throughput |
| -------------------- | -----: | -------: | -------: | -------: | -----------: |
| API `/health`        |      0 | 22.29 ms | 51.82 ms | 74.46 ms | 369.77 req/s |
| Web `/api-reference` |      0 | 20.96 ms | 81.66 ms | 86.03 ms | 343.13 req/s |

The 100,000-task integration reference loaded two table pages and one board page in 339 ms in the successful upgrade-copy run. These results do not replace realistic application-level staging load, browser performance, DB telemetry, CPU/memory data or approved concurrency targets. `k6` was unavailable.

# Worker Resilience

**PARTIAL.** With Redis stopped, API liveness stayed 200 and readiness became 503 in 9 ms; Worker liveness stayed 200 and readiness became 503 at the configured 2-second dependency timeout. After Redis restart both readiness endpoints recovered to 200. Worker restart during durable jobs, export/email/automation/deletion retries, duplicate delivery and stale lease recovery were not fully exercised.

# Observability / Alerts

**BLOCKED.** Structured logs and correlation IDs exist, and controlled errors were observed locally. No Sentry backend, metrics bearer token, Prometheus/Alertmanager, or real on-call notification destination was configured, so no real alert was delivered.

# Email

**BLOCKED.** No real staging email provider was configured. Password reset, verification, invitation, notification and scheduled-report delivery/links/locales/branding were not verified.

# Upgrade Test

**PASS locally.** A disposable copy of `calmboard_m5_stage` was created, migrations were reapplied to 0063, the source database was preserved, and integration tests passed: Database 39/39; API 8 passed, 0 failed, 2 skipped. The final verifier reported 64 migrations and successful tenant/authentication integration.

# Rollback / Forward Fix

**FAIL / FORWARD FIX PASS.** The M4 API image could not start under the hardened M5 environment contract because it requires `DATABASE_URL`; M5 intentionally supplies only the NOBYPASSRLS `DATABASE_APP_URL` to API runtime. Injecting a maintenance role into API runtime was rejected as an unsafe rollback workaround. Restoring the M5 image succeeded and readiness returned 200. A compatible immutable previous image plus an image-specific environment contract/runbook is required before RC.

# Retention / Disabled Features

- Organization lifecycle implementation: present and integration-tested.
- General Production Organization purge: **NO**, remains disabled.
- `RETAIN_UNTIL_POLICY` domains still require approved business/legal treatment.
- No legal retention duration was invented during M5.

# Bugs

## RC0

- **Operations:** no clean, committed, reproducible release baseline; 193 worktree entries remain outside a release commit.
- **Operations/Security:** no representative external staging ingress/TLS and production secret-management setup.
- **Billing:** mandatory Stripe real Test Mode lifecycle unavailable.
- **Reliability/Operations:** mandatory encrypted remote backup and isolated restore drill unavailable.
- **UX/Accessibility:** required interactive browser visual/RTL/theme/width QA unavailable.
- **Reliability:** required real email, scanner and observability/alert destinations unavailable.
- **Performance:** realistic staging load/scale/browser performance gate not executed.

## RC1

- **Operations:** rollback to the previous API image is incompatible with the hardened runtime DB environment contract.
- **Tooling/UX:** Firefox Playwright runner fails before page creation; cross-browser gate remains incomplete.
- **Security/Operations:** CSP/HSTS/API headers were not validated through a real ingress.
- **Closed during M5 — Reliability:** health probes were rate-limited, Worker readiness ignored Redis, and dependency checks could hang. Fixed and outage-tested.
- **Closed during M5 — Security:** sensitive request headers/query values were logged. Fixed, regression-tested and live-verified.
- **Closed during M5 — Operations:** API startup incorrectly required/received the maintenance database URL. Fixed with service-specific validation and Compose runtime separation.
- **Closed during M5 — Test reliability:** E2E locators no longer matched the current information architecture. Updated and passed on Chromium/WebKit.

## RC2

- **Tooling:** Next.js production build reports Node's `module.register()` deprecation warning; build remains green.

## RC3

- None recorded.

# Test Counts

- Repository unit tests: **441 passed, 0 failed**.
  - API 154, Worker 69, Database 81, Web 87, Licensing 27, Notifications 2, other packages/scripts 21.
- Production environment validation: 7 passed, 0 failed.
- Upgrade-copy Database integration: 39 passed, 0 failed.
- Upgrade-copy API integration: 8 passed, 0 failed, 2 skipped.
- Browser E2E final matrix: Chromium 4 passed; WebKit 4 passed; Firefox 4 infrastructure failures before page creation.
- Container scans: 3 images, 0 findings at every Grype severity.

# Full Gates

`pnpm run ci`: **PASS**. It completed environment validation, tracked-file secret scan, encoding scan, `db:check`, cycle scan over 554 files, route type generation, typecheck (10/10 packages), lint (10/10), formatting, 441 tests, and production builds (10/10 packages).

`git diff --check`: **PASS**.

Fresh migration, local health, image build, SBOM and container scan: **PASS**.

Overall M5 release gate: **FAIL**, because the RC0 external and baseline gates above remain open.

# Database

New migration created: NO

Backfill executed: NO

`0062_data_lifecycle` immutable: YES

`0063_export_scope` immutable: YES

# Final Decision

BLOCKED

The code and local deployment gates are substantially green, but M5 explicitly forbids Release Candidate without a clean baseline, real Stripe Test lifecycle, encrypted backup/isolated restore, interactive visual QA, representative staging ingress/security validation, usable observability/email/scanner integrations, and realistic load validation. No Production launch was performed.
