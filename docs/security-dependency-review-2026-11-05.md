# Security dependency review — 2026-11-05

## Scope and decision

The four remaining moderate audit findings were two affected `glob` resolutions
and two affected `minimatch` resolutions. The reviewed advisories identify
`glob` 14.0.2 and `minimatch` 11.0.1 as patched versions:
[glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Registry manifests were inspected before changing resolution. Compatible parent
lines still requested affected versions: Sentry bundler-plugins 10.78.0 still
requested glob 13, and TypeScript-ESTree 8.72.1 still requested minimatch 10.
Updating the Google detector to its newer line also changes its OpenTelemetry
major dependencies. The selected change retains the existing parent SDKs and
uses three consumer-scoped, affected-range overrides:

| Consumer                                | Original resolution                         | Patched resolution               | Contract exercised                                                                                                 |
| --------------------------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@sentry/bundler-plugins`               | glob 13.0.6                                 | glob 14.0.2                      | Actual Sentry map-file wrapper, absolute file discovery, ignores, aborted traversal                                |
| `rimraf` through Google metadata/gaxios | glob 10.5.0, which also brought minimatch 9 | glob 14.0.2 and minimatch 11.0.4 | Actual installed Rimraf async/sync glob deletion, independent filesystem checks, preservation of an unmatched file |
| `@typescript-eslint/typescript-estree`  | minimatch 10.2.6                            | minimatch 11.0.1                 | Project glob semantics and bounded hostile preprocessing in a memory/time-limited child                            |

Only affected ranges under those consumers are replaced. Unrelated legacy glob
and minimatch consumers retain their existing resolutions. The replacement package
engine declarations support Node 22, matching the project and verification host.
These are cross-major overrides, so the compatibility tests remain part of
`pnpm test` and must be reviewed when the parent packages are upgraded.

No new advisory exemption was added. The old `GHSA-vfj7-8cjw-p6xm` exemption was
removed after confirming that the [braces advisory was withdrawn](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The recorded audit has no findings at any severity and no muted advisories.
The shared quality gate now fails at **moderate** severity instead of high.
This describes the registry audit at verification time, not a guarantee against
unknown vulnerabilities or an operating-system/image vulnerability scan.

## Verification

The candidate uses an isolated source copy with Node 22.23.4 and pnpm 10.14.0,
fresh dependencies and no previous build output. The local verification input
commit is `dd12dac84e1ee3e613790ba122908ed4a9283f92`; it is not a pushed commit
or a modification to the user's branch.

- `pnpm install --frozen-lockfile` and the full `pnpm ci` succeeded.
- **983 tests passed**: Scripts 48, Notifications 2, Licensing 27, Database 251,
  Web 373, API 200 and Worker 82, with no failures/skips. Type generation,
  type checking, lint and all ten package builds passed.
- **125 integration tests and eight migration tests passed** on disposable
  PostgreSQL/Redis and a separate test bucket. The measured run left no new roles.
- **15 browser cases passed** across Chromium, Firefox and WebKit with retries=0,
  using the same patched source snapshot and isolated backend services.
- The final API Linux image passed its dependency contract probe on Node 22.23.4
  as UID 1001, with network disabled. The deployed Google metadata/Rimraf chain
  resolved glob 14.0.2 and its lockfile matcher 11.0.4; glob deletion preserved
  the unmatched file, and local private inputs were absent. The initial probe
  incorrectly expected the parser's matcher 11.0.1; it was corrected to the
  glob branch's actual pinned 11.0.4 before rerunning successfully.
- The three new tests resolve dependencies through their actual consuming
  packages, including Sentry's installed wrapper; they do not substitute a
  reimplementation. Temporary deletion targets are resolved and checked before
  Rimraf runs. Cancellation and malicious preprocessing are bounded explicitly.

Evidence: `artifacts/security-audit-after.json`,
`artifacts/followup-before-clean-verification.json` (the archived original clean
report), the `r0-clean-73beba00` install/CI logs,
`artifacts/security-compatibility.log`, `artifacts/r0-full-integration.json`,
`artifacts/r0-browser-matrix.json`, and `artifacts/security-linux-image-check.json`.
The generic clean/browser reports now track the subsequent navigation/webpack
follow-up; its distinct source revisions and evidence are documented in
[quality-gate.md](./quality-gate.md). The backend integration/migration report
still identifies this review's original source. No later web-only verification
is represented as a fresh integration or Linux-image run.

## Docker build privacy

The root `.dockerignore` previously did not exclude `artifacts/`, which now
contains local encrypted database checkpoints and verification copies. It now
excludes that directory, scratch data, local credential/configuration directories,
and nested test reports/coverage. A real build of the copied-source stage verified
that these paths and `.env` are absent while the package manifest matches the
current source. Evidence: `artifacts/security-context-check.json`.

This check covers the newly built context. Old local images/build caches were not
purged or declared reviewed, and no image was published. Keep backup material
outside image build contexts even when it is encrypted.

## Remaining release work

Remote CI and supply-chain scans must run on the final published source. The user
confirmed that no Staging environment currently exists; GitHub also lists no
configured repository environments. A new host, DNS/TLS ingress, registry and
external service configuration are still needed. The existing
[deployment runbook](../deploy/README.md) and
[release checklist](./release-checklist.md) remain the starting point. No host was
provisioned and no external provider was configured by this dependency repair.
