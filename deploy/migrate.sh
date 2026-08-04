#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

: "${CALMBOARD_ENV_FILE:?Set CALMBOARD_ENV_FILE to a plaintext env file outside the repository}"
[ -f "$CALMBOARD_ENV_FILE" ] || {
  printf 'Environment file not found: %s\n' "$CALMBOARD_ENV_FILE" >&2
  exit 1
}

compose() {
  docker compose \
    --env-file "$CALMBOARD_ENV_FILE" \
    -f "$REPO_ROOT/docker-compose.yml" \
    -f "$SCRIPT_DIR/docker-compose.staging.yml" \
    "$@"
}

printf 'Validating staging composition...\n'
compose config --quiet

printf 'Starting PostgreSQL and waiting for readiness...\n'
compose up -d --wait postgres

printf 'Provisioning least-privilege database roles...\n'
compose run --rm database-roles

printf 'Applying reviewed forward-only Drizzle migrations...\n'
compose run --rm --no-deps migrations

printf 'Migrations completed successfully. Deploy application images only after this command exits zero.\n'
