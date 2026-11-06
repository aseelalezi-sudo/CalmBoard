# Quality gate and reproducible local verification

`pnpm quality` is the shared static gate used by developers and GitHub Actions.
It runs dependency audit at the moderate threshold, environment checks, tracked-file
secret checks, encoding, dependency cycles, formatting, migration-file validation,
Next route type generation, forced type checks and forced lint. It stops at the
first failure and retains each check's combined stdout/stderr plus a JSON report
under ignored `artifacts/quality/`. The report records Git revision, worktree state,
Node version and lockfile SHA-256. A dirty worktree result is not a published
commit's CI result.

```bash
pnpm install --frozen-lockfile
pnpm quality
pnpm ci
```

`pnpm ci` additionally runs regression tests and the production build. The test
suite includes real PostgreSQL and Redis cases. Use an isolated migrated test
database for `DATABASE_URL`, `DATABASE_APP_URL` and `DATABASE_MAINTENANCE_URL`, and
an isolated Redis instance for `REDIS_URL`. Worker tests claim due jobs from their
database/queue; never point the test suite at a production or customer database.
Without a maintenance URL, some existing Worker integration cases report a skip.
CI explicitly supplies it so those cases actually execute.

The database/API integration suites and `pnpm test:migrations` are separate CI
steps after a fresh database has been migrated. Their object-storage integration
also requires the isolated MinIO service. Production image scans, SBOM and the
Chromium/Firefox/WebKit smoke matrix remain separate gates. Each image's artifact
bundle records source commit, lockfile checksum and image config digest. Locally
loaded images need not have a registry manifest digest; none is invented.

## Server lint scope

API and Worker use the shared TypeScript-only ESLint preset in
`scripts/eslint-server.mjs`. They apply unused-code/expression and correctness
rules to `src`, and type-aware floating/misused-promise and await checks to
production source. Test files use syntax rules without pretending they belong
to a production type-aware test project. No Next.js/React/browser rules are
applied to server code. Explicit `any` remains allowed in this initial rollout;
this is not a complete security review. Each server lint command rejects warnings.

## Dependency remediation on 2026-11-05

The audit failure from the latest inspected application CI run was reproduced.
Overrides now pin patched `follow-redirects` 1.16.2 and `joi` 18.3.1, and patched
`fast-uri` 3.1.9/4.2.3. Sources:
[follow-redirects advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p),
[Joi advisory](https://github.com/advisories/GHSA-4528-x5fx-h6hg),
[fast-uri maintainer advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg).
The four remaining moderate glob/minimatch findings were subsequently resolved
with consumer-scoped overrides and tests against the actual Sentry, Rimraf and
parser dependencies. The recorded audit now has zero findings at every severity,
with no ignored advisories. The old withdrawn advisory exemption was removed.
See the [dependency review](./security-dependency-review-2026-11-05.md) for the
cross-major compatibility checks and exact scope.

## Local evidence

The R0 verification creates a separate source snapshot, initializes its own local
Git history, and installs with `--frozen-lockfile`. It uses the official Windows
Node 22.23.4 binary verified against Node's distribution checksum and pnpm 10.14.0.
The snapshot contains neither local `.env` nor previous dependencies/build output.
Its file manifest, verification commit and phase results are recorded in
`artifacts/r0-clean-verification.json`. Temporary databases and Redis containers
are removed after the run. Existing development servers are not stopped.

Negative checks in another disposable source copy verified that formatting drift,
a real two-file source cycle, and an unhandled promise all fail their respective
gates; the probes were removed afterward. Evidence:
`artifacts/r0-negative-gates-2026-11-05.json`.

The sprint-analytics integration test now resides under `packages/database/integration`
and removes its RESTRICT-protected history before its tenant. Notification-email
and reminder tests create and clean their own tenants rather than borrowing a
pre-existing workspace/task. Isolated PostgreSQL comparisons verified unchanged
table contents before and after both test groups. Web transport tests explicitly
set their own API origin rather than assuming a developer's environment.

The security-review clean run passed **983 regression tests, 125 separate
integration tests, eight migration tests, and 15 browser cases**, with no skips.
Its local verification-only input was
`dd12dac84e1ee3e613790ba122908ed4a9283f92`.
The subsequent navigation/webpack follow-up passed the full clean `pnpm ci`
again on input `2de304132a5dd0e0b35a2b9b665e78b9fb01d827`: 983 regression
tests and all ten builds. Web lint now rejects warnings and passed with none.
The already-passed 125 integration/eight migration cases belong to the preceding
security run; the follow-up changes web navigation/build tooling only.

The browser input is `573b73c2c5e2a556049ae5ee8245cfa54189300e` in the same
isolated copy. After CI, only the new browser test's heading locator was corrected
to match the existing Arabic API-reference heading; production code and dependency
inputs are identical to the CI input. That one-file correction passed formatting
and web type checking before browser execution. Both manifests/revisions and the
exact delta are retained in `artifacts/r0-clean-verification.json` and
`artifacts/followup-ci-original-input.json`. These are local verification commits;
they were not pushed and do not change the user's branch. Browser runs use
retries=0, a production web build and a compiled API with isolated test-mode
backend services. They do not establish TLS/provider/production hardening.
The follow-up browser matrix passed **18 cases** across Chromium, Firefox and
WebKit, including document-preserving navigation and back navigation on each.
Next's generated `next-env.d.ts` is rewritten during builds.

The final evidence files are `artifacts/r0-clean-verification.json`,
`r0-full-integration.json`, `r0-browser-matrix.json`, and their linked logs.
The three web internal-navigation lint warnings were resolved with Next router
navigation. Invitation acceptance invalidates cached session/workspace-directory
queries before replacing the invitation route. The web package now supplies
webpack 5.112.2 explicitly, satisfying schema-utils' peer range; the previous
peer warning is absent from the fresh frozen install. Deprecation notices for
other existing transitive dependencies remain; this is not a zero-warning claim
for every tool. See the [webpack release notes](https://github.com/webpack/webpack/releases/tag/v5.112.2)
and [schema-utils package manifest](https://github.com/webpack/schema-utils/blob/v4.8.2/package.json).
The secret scan also handles unstaged moves
by checking a missing tracked file's index contents, preserving detection until
that entry is actually removed from the index.

See [development-status.md](./development-status.md) for the current closure state.

Protected-diagnostics and metrics HTTP smoke checks also passed on the isolated
compiled API: unauthenticated diagnostics returned 401, and metrics returned
Prometheus text with a process CPU metric. The metrics payload is checked in
memory and is not uploaded as a CI artifact; only the check outcome is retained.
CI completes curl before searching the response, avoiding grep's early pipe
closure being misreported as a failed scrape under `pipefail`.

The final role-delta probe also found and fixed cleanup leaks in export-scope and
M3 tests: they now revoke the fixture role's owned grants before dropping it, and
do not suppress a failed drop. The subsequent full integration run left zero new
roles. Two roles attributable to the earlier measured run were removed only after
checking that no dependencies remained. Other unattributed historical fixture
roles were left untouched. Final database/catalog, resource cleanup and development
service health checks are recorded in `artifacts/r0-final-state.json`.
