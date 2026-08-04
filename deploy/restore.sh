#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP="${1:-}"
[[ "$TIMESTAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || {
  printf 'Usage: %s YYYY-MM-DD_HH-MM-SS\n' "$0" >&2
  exit 2
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is not installed: $1"
}

require_env() {
  [ -n "${!1:-}" ] || fail "Required environment variable is missing: $1"
}

for command_name in age docker mc sha256sum tar; do
  require_command "$command_name"
done

require_env AGE_PRIVATE_KEY_FILE
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_ACCESS_KEY_ID
require_env BACKUP_S3_SECRET_ACCESS_KEY
[ -f "$AGE_PRIVATE_KEY_FILE" ] || fail "Age identity file not found: $AGE_PRIVATE_KEY_FILE"

RESTORE_COMPOSE_FILE="${RESTORE_COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.restore.yml}"
[ -f "$RESTORE_COMPOSE_FILE" ] || fail "Restore compose file not found: $RESTORE_COMPOSE_FILE"

WORK_ROOT="${RESTORE_WORK_ROOT:-${TMPDIR:-/tmp}}"
RESTORE_DIR="$(mktemp -d "$WORK_ROOT/calmboard-restore-${TIMESTAMP}.XXXXXX")"
MC_CONFIG_DIR="$RESTORE_DIR/mc-config"
DATABASE_ENCRYPTED="$RESTORE_DIR/database.dump.age"
ATTACHMENTS_ENCRYPTED="$RESTORE_DIR/attachments.tar.gz.age"
CHECKSUMS="$RESTORE_DIR/checksums.sha256"
DATABASE_DUMP="$RESTORE_DIR/database.dump"
ATTACHMENTS_DIR="$RESTORE_DIR/attachments"

cleanup() {
  rm -rf -- "$RESTORE_DIR"
}
trap cleanup EXIT

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-calmboard-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-calmboard}"
RESTORE_PROJECT_NAME="${RESTORE_PROJECT_NAME:-calmboard-restore}"
RESTORE_POSTGRES_USER="${RESTORE_POSTGRES_USER:-calmboard_restore}"
RESTORE_POSTGRES_DB="${RESTORE_POSTGRES_DB:-calmboard_restore}"
RESTORE_S3_ENDPOINT="${RESTORE_S3_ENDPOINT:-http://127.0.0.1:19000}"
RESTORE_MINIO_USER="${RESTORE_MINIO_USER:-calmboard_restore}"
RESTORE_MINIO_PASSWORD="${RESTORE_MINIO_PASSWORD:-local-restore-only-change-me}"
RESTORE_S3_BUCKET="${RESTORE_S3_BUCKET:-calmboard-attachments-restore}"

mkdir -p "$MC_CONFIG_DIR" "$ATTACHMENTS_DIR"

printf 'Downloading encrypted artifacts...\n'
mc --config-dir "$MC_CONFIG_DIR" alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
REMOTE_PATH="backup/$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$TIMESTAMP"
mc --config-dir "$MC_CONFIG_DIR" cp \
  "$REMOTE_PATH/database.dump.age" \
  "$REMOTE_PATH/attachments.tar.gz.age" \
  "$REMOTE_PATH/checksums.sha256" \
  "$RESTORE_DIR/"

printf 'Verifying checksums and decrypting...\n'
(
  cd "$RESTORE_DIR"
  sha256sum --check "$(basename "$CHECKSUMS")"
)
age --decrypt --identity "$AGE_PRIVATE_KEY_FILE" --output "$DATABASE_DUMP" "$DATABASE_ENCRYPTED"
age --decrypt --identity "$AGE_PRIVATE_KEY_FILE" --output - "$ATTACHMENTS_ENCRYPTED" | tar -xzf - -C "$ATTACHMENTS_DIR"

printf 'Starting isolated restore services...\n'
RESTORE_POSTGRES_USER="$RESTORE_POSTGRES_USER" \
RESTORE_POSTGRES_DB="$RESTORE_POSTGRES_DB" \
RESTORE_MINIO_USER="$RESTORE_MINIO_USER" \
RESTORE_MINIO_PASSWORD="$RESTORE_MINIO_PASSWORD" \
  docker compose --project-name "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" up -d --wait

printf 'Restoring PostgreSQL into the isolated drill database...\n'
docker compose --project-name "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" exec -T restore-postgres \
  pg_restore --username "$RESTORE_POSTGRES_USER" --dbname "$RESTORE_POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges \
  <"$DATABASE_DUMP"
docker compose --project-name "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" exec -T restore-postgres \
  psql --username "$RESTORE_POSTGRES_USER" --dbname "$RESTORE_POSTGRES_DB" --tuples-only --command 'SELECT 1' \
  | grep -q '1' || fail "PostgreSQL restore verification failed"

printf 'Restoring attachments into the isolated drill bucket...\n'
mc --config-dir "$MC_CONFIG_DIR" alias set restore "$RESTORE_S3_ENDPOINT" "$RESTORE_MINIO_USER" "$RESTORE_MINIO_PASSWORD" >/dev/null
mc --config-dir "$MC_CONFIG_DIR" mb --ignore-existing "restore/$RESTORE_S3_BUCKET" >/dev/null
mc --config-dir "$MC_CONFIG_DIR" mirror --overwrite "$ATTACHMENTS_DIR" "restore/$RESTORE_S3_BUCKET"

printf 'Restore drill completed successfully. Isolated services remain running for inspection.\n'
printf 'Stop them with: docker compose --project-name %s -f %s down\n' "$RESTORE_PROJECT_NAME" "$RESTORE_COMPOSE_FILE"
