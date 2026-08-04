#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +"%Y-%m-%d_%H-%M-%S")}"
WORK_ROOT="${BACKUP_WORK_ROOT:-${TMPDIR:-/tmp}}"
BACKUP_DIR="$(mktemp -d "$WORK_ROOT/calmboard-backup-${TIMESTAMP}.XXXXXX")"
MC_CONFIG_DIR="$BACKUP_DIR/mc-config"
DATABASE_DUMP="$BACKUP_DIR/database.dump"
ATTACHMENTS_DIR="$BACKUP_DIR/attachments"
ATTACHMENTS_ARCHIVE="$BACKUP_DIR/attachments.tar.gz"
DATABASE_ENCRYPTED="$BACKUP_DIR/database.dump.age"
ATTACHMENTS_ENCRYPTED="$BACKUP_DIR/attachments.tar.gz.age"
CHECKSUMS="$BACKUP_DIR/checksums.sha256"

cleanup() {
  rm -rf -- "$BACKUP_DIR"
}
trap cleanup EXIT

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

require_env AGE_RECIPIENT
require_env S3_ENDPOINT
require_env S3_ACCESS_KEY_ID
require_env S3_SECRET_ACCESS_KEY
require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_ACCESS_KEY_ID
require_env BACKUP_S3_SECRET_ACCESS_KEY

if [ "$S3_ENDPOINT" = "$BACKUP_S3_ENDPOINT" ] && [ "${ALLOW_SAME_BACKUP_ENDPOINT:-false}" != "true" ]; then
  fail "BACKUP_S3_ENDPOINT must be independent from S3_ENDPOINT. Set ALLOW_SAME_BACKUP_ENDPOINT=true only for a local drill."
fi

COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose.yml}"
POSTGRES_USER="${POSTGRES_USER:-calmboard}"
POSTGRES_DB="${POSTGRES_DB:-calmboard_db}"
S3_BUCKET="${S3_BUCKET:-calmboard-attachments}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-calmboard-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-calmboard}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

[[ "$BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETENTION_DAYS must be a positive integer"
[ -f "$COMPOSE_FILE" ] || fail "Compose file not found: $COMPOSE_FILE"

mkdir -p "$MC_CONFIG_DIR" "$ATTACHMENTS_DIR"

printf 'Creating PostgreSQL dump...\n'
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom \
  >"$DATABASE_DUMP"
[ -s "$DATABASE_DUMP" ] || fail "PostgreSQL produced an empty dump"

printf 'Mirroring attachment objects...\n'
mc --config-dir "$MC_CONFIG_DIR" alias set source "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
mc --config-dir "$MC_CONFIG_DIR" mirror --overwrite "source/$S3_BUCKET" "$ATTACHMENTS_DIR"

tar -czf "$ATTACHMENTS_ARCHIVE" -C "$ATTACHMENTS_DIR" .

printf 'Encrypting backup artifacts...\n'
age --recipient "$AGE_RECIPIENT" --output "$DATABASE_ENCRYPTED" "$DATABASE_DUMP"
age --recipient "$AGE_RECIPIENT" --output "$ATTACHMENTS_ENCRYPTED" "$ATTACHMENTS_ARCHIVE"

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$DATABASE_ENCRYPTED")" "$(basename "$ATTACHMENTS_ENCRYPTED")" >"$(basename "$CHECKSUMS")"
)

printf 'Uploading encrypted backup to the independent destination...\n'
mc --config-dir "$MC_CONFIG_DIR" alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
mc --config-dir "$MC_CONFIG_DIR" mb --ignore-existing "backup/$BACKUP_S3_BUCKET" >/dev/null

REMOTE_PATH="backup/$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$TIMESTAMP"
mc --config-dir "$MC_CONFIG_DIR" cp "$DATABASE_ENCRYPTED" "$ATTACHMENTS_ENCRYPTED" "$CHECKSUMS" "$REMOTE_PATH/"

if [ "${BACKUP_DISABLE_RETENTION:-false}" != "true" ]; then
  mc --config-dir "$MC_CONFIG_DIR" rm --recursive --force --older-than "${BACKUP_RETENTION_DAYS}d" \
    "backup/$BACKUP_S3_BUCKET/$BACKUP_PREFIX/" >/dev/null
fi

printf 'Backup completed: %s/%s/%s\n' "$BACKUP_S3_BUCKET" "$BACKUP_PREFIX" "$TIMESTAMP"
