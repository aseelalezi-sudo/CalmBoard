import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeAIProviderRequest } from "./ai-privacy.js";

describe("AI request privacy filter", () => {
  it("replaces secrets and personal identifiers consistently before provider access", () => {
    const sensitiveValues = [
      "admin@example.com",
      "+966 50 123 4567",
      "0512345678",
      "4242 4242 4242 4242",
      "SA0380000000608010167519",
      "192.168.10.25",
      "550e8400-e29b-41d4-a716-446655440000",
      "123-45-6789",
      "1234567890",
      "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123",
      "super-secret-password",
      "https://user:password@example.com/private",
      "https://example.com/callback?access_token=top-secret",
      "postgresql://admin:database-password@db.internal/calmboard",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      "PROJ-742",
    ];
    const request = {
      action: "report" as const,
      text: [
        "Email admin@example.com then admin@example.com.",
        "Phone +966 50 123 4567 or 0512345678.",
        "Card 4242 4242 4242 4242, IBAN SA0380000000608010167519.",
        "Host 192.168.10.25 and record 550e8400-e29b-41d4-a716-446655440000.",
        "Identifiers 123-45-6789 and 1234567890.",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123",
        "password=super-secret-password and sk-ant-abcdefghijklmnopqrstuvwxyz123456",
        "Private https://user:password@example.com/private and https://example.com/callback?access_token=top-secret.",
        "Database postgresql://admin:database-password@db.internal/calmboard.",
        "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
        "Public documentation https://example.com/docs remains useful.",
      ].join("\n"),
      tasks: [
        {
          serial: "PROJ-742",
          title: "Contact admin@example.com from 192.168.10.25",
          status: "in_progress",
          priority: "high",
          progress: 20,
          dueDate: null,
        },
      ],
      safetyIdentifier: "hashed-stable-identifier",
    };

    const sanitized = sanitizeAIProviderRequest(request);
    const serialized = JSON.stringify(sanitized);
    for (const sensitiveValue of sensitiveValues) assert.equal(serialized.includes(sensitiveValue), false);
    assert.match(sanitized.text, /\[EMAIL_1\]/);
    assert.equal(sanitized.text.match(/\[EMAIL_1\]/g)?.length, 2);
    assert.match(sanitized.text, /\[PHONE_1\]/);
    assert.match(sanitized.text, /\[PAYMENT_CARD_1\]/);
    assert.match(sanitized.text, /\[IBAN_1\]/);
    assert.match(sanitized.text, /\[IP_ADDRESS_1\]/);
    assert.match(sanitized.text, /\[UUID_1\]/);
    assert.match(sanitized.text, /\[NATIONAL_ID_[12]\]/);
    assert.match(sanitized.text, /\[PRIVATE_KEY_1\]/);
    assert.match(sanitized.text, /\[SENSITIVE_URL_[12]\]/);
    assert.ok(sanitized.text.includes("https://example.com/docs"));
    assert.equal(sanitized.tasks[0]?.serial, "[TASK_REFERENCE_1]");
    assert.ok(sanitized.tasks[0]?.title.includes("[EMAIL_1]"));
    assert.ok(sanitized.tasks[0]?.title.includes("[IP_ADDRESS_1]"));
    assert.equal(sanitized.safetyIdentifier, request.safetyIdentifier);
    assert.equal(request.tasks[0]?.serial, "PROJ-742");
  });

  it("does not redact ordinary numbers or invalid payment and IP values", () => {
    const sanitized = sanitizeAIProviderRequest({
      text: "Progress 75, estimate 1234567890123, version 999.999.999.999.",
      tasks: [],
    });
    assert.equal(sanitized.text, "Progress 75, estimate 1234567890123, version 999.999.999.999.");
  });
});
