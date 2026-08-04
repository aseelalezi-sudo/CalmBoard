# CalmBoard release checklist

Record the release SHA, operator, timestamps, evidence links, and result for each
item. A failed mandatory item blocks promotion.

## Source control

- [x] The repository has a reviewed baseline commit and `HEAD` resolves successfully.
- [ ] The release commit is pushed to the protected remote branch and its CI run is green.

## Before deployment

- [ ] CI is green: audit, environment validation, migration verification,
      tests, typecheck, lint, production builds, integration tests, and Chromium
      E2E.
- [ ] API, Worker, Web, and Migrator images use the same immutable commit SHA.
- [ ] Image vulnerability and secret scans contain no unaccepted high/critical
      findings.
- [ ] `docker compose ... config --quiet` succeeds with the target secret set.
- [ ] A recent encrypted off-site backup exists and its checksum is recorded.
- [ ] A restore drill has succeeded within the agreed recovery-test interval.
- [ ] Schema changes are backward compatible with the currently deployed image.
- [ ] Previous known-good image tags are recorded for rollback.
- [ ] Sentry/OTLP endpoints, alert routing, and on-call ownership are configured.

## Deployment

- [ ] Provision/rotate database roles and apply migrations once.
- [ ] Confirm the migration job exits successfully before API/Worker start.
- [ ] Confirm API `/health` and web `/api/health` return HTTP 200.
- [ ] Confirm Worker `/health` is healthy inside the service network.
- [ ] Run authentication and tenant-isolation smoke tests.
- [ ] Verify object upload/download and one queue job end-to-end.
- [ ] Verify logs contain a request/correlation identifier and no secrets.
- [ ] Observe error rate, p95 latency, queue depth, and database saturation during
      the release window.

## Promotion and rollback

- [ ] Promote the exact staging image digests; do not rebuild for production.
- [ ] Record the deployment event in the operational log.
- [ ] If an SLO or smoke check fails, revert all application image references to
      the previous SHA. Do not run down-migrations.
- [ ] After rollback, rerun health/smoke checks and open an incident for follow-up.

## After deployment

- [ ] Monitor for at least one normal background-job interval.
- [ ] Confirm scheduled reports, email outbox, automation events, exports, and
      attachment cleanup are processing without retries/dead letters.
- [ ] Confirm the next scheduled off-site backup completes.
- [ ] Attach CI, deploy, monitoring, and backup evidence to the release record.
