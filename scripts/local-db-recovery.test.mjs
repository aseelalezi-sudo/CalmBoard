import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  assertMatchingTables,
  assertRecoveryDatabase,
  authenticateReceipt,
  receiptSignature,
  recoveryDatabaseName,
} from "./local-db-recovery.mjs";

test("recovery receipts reject changed bytes, another identity and invalid signatures", () => {
  const identity = randomBytes(32);
  const receipt = { version: 1, archiveSha256: "a".repeat(64), tables: [{ rows: 10 }] };
  const bytes = Buffer.from(JSON.stringify(receipt));
  const signature = receiptSignature(bytes, identity);
  assert.deepEqual(authenticateReceipt(bytes, signature, identity), receipt);
  assert.throws(
    () => authenticateReceipt(Buffer.from(JSON.stringify({ ...receipt, tables: [] })), signature, identity),
    /authentication failed/,
  );
  assert.throws(() => authenticateReceipt(bytes, signature, randomBytes(32)), /authentication failed/);
  for (const value of ["", "bad", "a".repeat(63), "z".repeat(64)])
    assert.throws(() => authenticateReceipt(bytes, value, identity), /authentication failed/);
});

test("recovery comparison rejects missing tables, missing rows and changed row contents", () => {
  const source = [{ schema: "public", name: "items", rows: 2, sha256: "a".repeat(64) }];
  assert.doesNotThrow(() => assertMatchingTables(source, structuredClone(source)));
  for (const restored of [[], [{ ...source[0], rows: 1 }], [{ ...source[0], sha256: "b".repeat(64) }]])
    assert.throws(() => assertMatchingTables(source, restored), /differ/);
});

test("cleanup accepts only uniquely generated recovery databases", () => {
  assert.doesNotThrow(() => assertRecoveryDatabase(recoveryDatabaseName()));
  for (const value of [
    "calmboard",
    "postgres",
    "calmboard_recovery_1_test",
    'calmboard_recovery_1_aaaaaaaaaaaaaaaa";drop database calmboard',
  ])
    assert.throws(() => assertRecoveryDatabase(value), /Unsafe/);
});
