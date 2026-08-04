# ADR 0004: Queue authentication email in an encrypted outbox

- Status: Accepted
- Date: 2026-07-28

## Context

Email verification and password-reset messages contain raw one-time tokens. Sending them during the API request made delivery vulnerable to provider latency and process restarts. Reusing the tenant notification outbox would expose the token and recipient in plaintext and mix security-sensitive global work with tenant-scoped notifications.

## Decision

Authentication email uses a dedicated `auth_email_outbox`. The repository creates the hashed authentication token and its outbox row in one PostgreSQL transaction. If encryption cannot be initialized, neither record is created.

The recipient, display name, subject, HTML, and one-time link are encrypted with AES-256-GCM before persistence. Additional authenticated data binds the ciphertext to the outbox ID, user ID, authentication-token ID, purpose, and key version. Configuration supports a versioned keyring and an explicit active key for rotation.

Only the worker decrypts the payload. After claiming a row with `FOR UPDATE SKIP LOCKED` and a UUID claim token, it revalidates that the linked token belongs to the user and purpose, remains active and unexpired, and that the account email still matches the encrypted recipient.

Provider failures return to `pending` with exponential backoff and eventually become `dead`. Resend receives a stable `Idempotency-Key` based on the outbox ID. Database constraints and a trigger make delivery identity and ciphertext immutable, prevent attempts from decreasing, and prevent terminal rows from reopening.

## Consequences

- API requests do not call the email provider or retain the raw token after building the encrypted payload.
- Token creation and durable delivery intent cannot commit separately.
- Database readers cannot recover recipients, templates, or raw authentication tokens without the application key.
- Key rotation must retain old versions until no queued row references them.
- Operators can inspect delivery state and errors without exposing message content.
- The worker requires access to authentication-email encryption keys and the maintenance database connection.
