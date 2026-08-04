# ADR 0024: Versioned forms, conditional logic, and Turnstile

- Status: Accepted
- Date: 2026-07-30

## Context

Forms stored untyped JSON and the management screen could only create a fixed three-field template. The public endpoint trusted arbitrary answer keys, did not enforce required fields, and had no bot challenge. Conditional visibility existed neither in the builder nor in server validation.

## Decision

Form definitions use a versioned schema with bounded field types, labels, options, task mappings, and settings. A conditional field may reference only an earlier field, preventing dependency cycles and making ordered evaluation deterministic. The browser evaluates conditions for presentation, but the API evaluates them again, validates only visible fields, drops hidden and unknown values, and enforces size and type constraints before persistence.

Each form can enable Cloudflare Turnstile. The public API returns only the site key and validates the single-use token server-side through Siteverify before writing a response or creating a task. Production fails closed when Turnstile keys are absent. Local development and automated tests use Cloudflare's official test keys.

Responses remain directly tenant-scoped. Database checks require versioned object settings, array field definitions, object response data, and non-negative response counts. Response-to-task links use a foreign key, while tenant and project validation remain in the repository.

## Consequences

- UI manipulation cannot bypass required fields or reveal-and-submit hidden answers.
- Conditional definitions are acyclic by construction but cannot depend on a later field.
- CAPTCHA secrets never reach the browser or database.
- Turnstile availability is part of the public submission path when protection is enabled.
- Existing form settings are upgraded to schema version 1 during migration while preserving their prior task settings.
