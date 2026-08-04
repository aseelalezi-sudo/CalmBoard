#!/usr/bin/env sh
set -eu

: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to an age public recipient key}"
: "${SECRETS_PLAIN_FILE:?Set SECRETS_PLAIN_FILE to a plaintext env file outside the repository}"

SECRETS_ENCRYPTED_FILE="${SECRETS_ENCRYPTED_FILE:-deploy/secrets.enc.env}"

command -v sops >/dev/null 2>&1 || {
  echo "sops is required" >&2
  exit 1
}

if [ ! -s "$SECRETS_PLAIN_FILE" ]; then
  echo "Plaintext secrets file is missing or empty: $SECRETS_PLAIN_FILE" >&2
  exit 1
fi

temporary_file="${SECRETS_ENCRYPTED_FILE}.tmp"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM

sops --encrypt \
  --age "$AGE_RECIPIENT" \
  --input-type dotenv \
  --output-type dotenv \
  "$SECRETS_PLAIN_FILE" >"$temporary_file"

if [ ! -s "$temporary_file" ]; then
  echo "SOPS produced an empty encrypted file" >&2
  exit 1
fi

mv "$temporary_file" "$SECRETS_ENCRYPTED_FILE"
trap - EXIT HUP INT TERM
echo "Encrypted secrets written to $SECRETS_ENCRYPTED_FILE"
