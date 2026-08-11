# CalmBoard deployment runbook

This directory contains the staging composition, database-role provisioning,
encrypted backup, and isolated restore-drill tools. Run deployment commands from
the repository root on a Linux host with Docker Compose v2.

## Required tools

- Docker Engine and Docker Compose v2
- `age`, `mc` (MinIO client), `sha256sum`, and `tar` for backup/restore jobs
- `sops` only when producing or rotating `secrets.enc.env`

Keep plaintext environment files and the age private identity outside the
repository. `deploy/secrets.example.env` is a variable-name template only.

## Images

Build immutable images in CI and tag them with a commit SHA:

```sh
docker build -f apps/web/Dockerfile -t registry.example/calmboard-web:$GIT_SHA .
docker build -f apps/api/Dockerfile --target runner -t registry.example/calmboard-api:$GIT_SHA .
docker build -f apps/api/Dockerfile --target migrator -t registry.example/calmboard-migrations:$GIT_SHA .
docker build -f apps/worker/Dockerfile -t registry.example/calmboard-worker:$GIT_SHA .
```

The web image bakes `NEXT_PUBLIC_API_URL` at build time. Set its build argument
to the public staging/production API origin when building that image. Keep
`NEXT_PUBLIC_TELEMETRY_UI_ENABLED` and `NEXT_PUBLIC_WEBAUTHN_UI_ENABLED` false
unless the corresponding preview has been explicitly approved for that image.

## Secrets

To create the optional SOPS-encrypted dotenv file, point the setup script at a
plaintext file outside the checkout:

```sh
AGE_RECIPIENT=age1... \
SECRETS_PLAIN_FILE=/secure/calmboard/staging.env \
SECRETS_ENCRYPTED_FILE=deploy/secrets.enc.env \
./deploy/setup.sh
```

At deploy time, decrypt into a mode-`0600` temporary file outside the checkout,
pass that file with Compose's `--env-file`, then remove it. A platform secret
manager such as Infisical, Doppler, Vault, AWS Secrets Manager, or Kubernetes
Secrets may inject the same variables directly.

Never pass `deploy/secrets.enc.env` directly to `--env-file`; it is encrypted
content, not dotenv plaintext.

## Staging

The staging override:

- exposes web and API on loopback only;
- does not expose PostgreSQL, Redis, or MinIO host ports;
- provisions an API role with `NOSUPERUSER NOBYPASSRLS`;
- provisions a separate non-superuser maintenance role with `BYPASSRLS` for
  cross-tenant background jobs;
- completes role provisioning and migrations before API/Worker start; and
- uses prebuilt immutable images rather than local Docker build definitions.

`TRUST_PROXY_HOPS` is the number of trusted forwarding hops immediately in
front of the API. Use `1` for the documented topology
`client -> TLS reverse proxy/load balancer -> CalmBoard API`, `0` only when the
API is directly exposed, and increase it only when an additional trusted proxy
is deliberately inserted. Do not count an untrusted client-controlled hop.

Set these image references in the external environment file:

```dotenv
CALMBOARD_WEB_IMAGE=registry.example/calmboard-web:<commit-sha>
CALMBOARD_API_IMAGE=registry.example/calmboard-api:<commit-sha>
CALMBOARD_MIGRATIONS_IMAGE=registry.example/calmboard-migrations:<commit-sha>
CALMBOARD_WORKER_IMAGE=registry.example/calmboard-worker:<commit-sha>
```

Validate and start staging:

```sh
docker compose --env-file /secure/calmboard/staging.env \
  -f docker-compose.yml -f deploy/docker-compose.staging.yml config --quiet

docker compose --env-file /secure/calmboard/staging.env \
  -f docker-compose.yml -f deploy/docker-compose.staging.yml \
  pull web api migrations worker

docker compose --env-file /secure/calmboard/staging.env \
  -f docker-compose.yml -f deploy/docker-compose.staging.yml \
  up -d --no-build --wait
```

Check `http://127.0.0.1:${STAGING_API_PORT:-4000}/health` and
`http://127.0.0.1:${STAGING_WEB_PORT:-3000}/api/health`, then run the smoke and
security-isolation suites before promotion.

## Monitoring and alert delivery

The observability overlay starts Prometheus, Alertmanager, OpenTelemetry
Collector, and Tempo. Copy `deploy/alertmanager.example.yml` to a protected path,
replace the example receiver with the deployment's real notification endpoint,
and set `ALERTMANAGER_CONFIG_FILE` to that absolute path. Keep receiver tokens and
credentials outside the repository.

Prometheus forwards firing and resolved alerts to `alertmanager:9093` inside the
Compose network. Before promotion, validate both configurations and deliver a
test alert through the complete Prometheus-to-Alertmanager-to-receiver path; a
healthy Alertmanager process alone does not prove notification delivery.

## Backups

`backup.sh` requires an age public recipient and credentials for both the source
object store and an independent backup object store. By default it refuses to
store the backup at the same endpoint as live attachments.

```sh
env \
  AGE_RECIPIENT=age1... \
  S3_ENDPOINT=https://objects.internal.example \
  S3_ACCESS_KEY_ID=... \
  S3_SECRET_ACCESS_KEY=... \
  BACKUP_S3_ENDPOINT=https://backup.example \
  BACKUP_S3_ACCESS_KEY_ID=... \
  BACKUP_S3_SECRET_ACCESS_KEY=... \
  BACKUP_RETENTION_DAYS=30 \
  ./deploy/backup.sh
```

Schedule this command from the host scheduler using a least-privilege backup
credential. Monitor its exit code and alert on a missed daily backup. Enable
bucket versioning/object lock and lifecycle policies at the external provider;
the script's retention cleanup is not a substitute for provider-side immutability.

## Restore drill

`restore.sh` accepts only a UTC timestamp generated by `backup.sh`. It downloads
and verifies checksums before decrypting. It always restores into the isolated
services in `docker-compose.restore.yml`; it cannot target the live Compose
database.

The drill restores with `--no-owner --no-privileges`, so it does not require the
source database role names and all restored objects remain owned by
`RESTORE_POSTGRES_USER`. Reapply and verify the target environment's application
and maintenance role grants as part of a controlled production cutover.

```sh
env \
  AGE_PRIVATE_KEY_FILE=/secure/calmboard/backup.agekey \
  BACKUP_S3_ENDPOINT=https://backup.example \
  BACKUP_S3_ACCESS_KEY_ID=... \
  BACKUP_S3_SECRET_ACCESS_KEY=... \
  ./deploy/restore.sh 2026-08-02_01-00-00
```

Inspect the isolated database on `127.0.0.1:55432` and the restored object store
on `127.0.0.1:19000`. After verification, remove only the drill stack:

```sh
docker compose --project-name calmboard-restore \
  -f deploy/docker-compose.restore.yml down --volumes
```

Never use the restore script as an in-place production restore. A production
incident restore requires a new database/object-store target, validation, and a
controlled traffic cutover.

## Rollback

Application rollback means setting the four image variables to the previously
verified commit and running staging/production Compose again with `--no-build`.
Do not run down-migrations. Database changes must follow expand/migrate/contract
so both the previous and current application versions remain compatible during
the rollback window.

## Production deployment checklist

Record an owner and timestamp for every item. A green container process alone is
not release evidence.

1. Confirm the release commit, review its SBOM/Grype artifacts, and require no
   unresolved release-blocking High/Critical finding.
2. Validate the external environment with `pnpm run check:env`. Confirm that no
   plaintext secret or local `.env` is part of the image/build context.
3. Decide whether a fresh encrypted database/object backup is required. Record
   the last successful backup and isolated restore-drill reference; do not claim
   an RPO/RTO that has not been measured.
4. Verify the migration journal and pristine chain. Run the migrator image once
   before application rollout. Migrations are forward-only; never improvise a
   down-migration during an incident.
5. Roll out API and Worker, verify `/health`, readiness, database/Redis/object
   storage connectivity and queue progress, then roll out Web and verify
   `/api/health`.
6. Run authenticated smoke checks for login, tenant-scoped reads/writes, private
   attachment resolution, export request/download, billing state, and a
   cross-tenant denial. Verify Prometheus scrape and alert delivery.
7. Verify Stripe Test/Staging checkout, webhook ordering/idempotency, subscription
   recovery/cancellation, and portal behavior before enabling a billing change.
8. Keep `ORGANIZATION_PURGE_ENABLED=false` until all retention classifications
   are approved. Live Stripe cleanup additionally requires both an approved
   `STRIPE_PURGE_MODE` and `STRIPE_LIVE_PURGE_ENABLED=true`.

Rollback criteria include failed readiness, tenant-isolation regression,
unrecoverable queue growth, object-resolution failure, or incorrect billing
state. Roll application images back only when the previous version is compatible
with the already-applied schema; otherwise use a reviewed forward fix. Do not
unfreeze or reconstruct a tenant whose irreversible purge has started.

The incident commander owns the go/no-go decision, rollback/forward-fix choice,
customer communication and evidence log. The database owner runs migrations and
restore validation; the application owner validates API/Web/Worker; the security
owner reviews secret, SBOM and vulnerability findings; the billing owner verifies
Stripe. Store actual names and escalation channels in the private operations
system, not this repository.

Use the [backup](#backups) and [restore drill](#restore-drill) procedures above.
Each drill record must include backup/restore durations, artifact checksums,
migration parity through the deployed migration, critical FK/RLS and tenant
isolation results, application reads, attachment resolution and smoke evidence.
