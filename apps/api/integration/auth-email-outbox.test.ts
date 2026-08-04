import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { authEmailOutbox, authTokens, db, hashAuthToken, pool, users } from "@calmboard/database";
import { decryptAuthEmailPayload } from "@calmboard/notifications";
import { eq } from "drizzle-orm";
import { AuthEmailService } from "../src/auth-email.service.js";

after(async () => {
  await pool.end();
});

describe("authentication email outbox", () => {
  it("creates the token and encrypted delivery atomically", async () => {
    const previousKey = process.env.AUTH_EMAIL_ENCRYPTION_KEY;
    const previousKeys = process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
    const previousVersion = process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION;
    const previousAppUrl = process.env.APP_URL;
    process.env.AUTH_EMAIL_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    delete process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
    process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION = "1";
    process.env.APP_URL = "https://calmboard.example.test";

    const userId = randomUUID();
    const email = `auth-outbox-${userId}@example.test`;
    try {
      await db.insert(users).values({ id: userId, email, name: "Outbox integration user" });

      const service = new AuthEmailService();
      assert.equal(
        await service.send({
          purpose: "password_reset",
          userId,
          email,
          name: "Outbox integration user",
          requestedIp: "127.0.0.1",
        }),
        true,
      );

      const [token] = await db.select().from(authTokens).where(eq(authTokens.userId, userId));
      const [outbox] = await db.select().from(authEmailOutbox).where(eq(authEmailOutbox.userId, userId));
      assert.ok(token);
      assert.ok(outbox);
      assert.equal(outbox.authTokenId, token.id);
      assert.equal(outbox.purpose, token.purpose);
      assert.equal(outbox.status, "pending");
      assert.equal(outbox.encryptionAlgorithm, "aes-256-gcm");

      const decrypted = decryptAuthEmailPayload(
        {
          id: outbox.id,
          userId: outbox.userId,
          authTokenId: outbox.authTokenId,
          purpose: "password_reset",
        },
        {
          encryptedPayload: outbox.encryptedPayload,
          initializationVector: outbox.initializationVector,
          authenticationTag: outbox.authenticationTag,
          encryptionAlgorithm: "aes-256-gcm",
          encryptionKeyVersion: outbox.encryptionKeyVersion,
        },
      );
      assert.equal(decrypted.to, email);
      const link = decrypted.html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
      assert.ok(link);
      const rawToken = new URL(link).searchParams.get("token");
      assert.ok(rawToken);
      assert.equal(token.tokenHash, hashAuthToken(rawToken));
      assert.equal(outbox.encryptedPayload.includes(rawToken), false);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
      if (previousKey === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_KEY;
      else process.env.AUTH_EMAIL_ENCRYPTION_KEY = previousKey;
      if (previousKeys === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
      else process.env.AUTH_EMAIL_ENCRYPTION_KEYS = previousKeys;
      if (previousVersion === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION;
      else process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION = previousVersion;
      if (previousAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousAppUrl;
    }
  });

  it("does not create a token when encryption cannot be initialized", async () => {
    const previousKey = process.env.AUTH_EMAIL_ENCRYPTION_KEY;
    const previousKeys = process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
    const userId = randomUUID();
    try {
      delete process.env.AUTH_EMAIL_ENCRYPTION_KEY;
      delete process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
      await db.insert(users).values({
        id: userId,
        email: `auth-outbox-failure-${userId}@example.test`,
        name: "Outbox failure user",
      });

      await assert.rejects(
        () =>
          new AuthEmailService().send({
            purpose: "email_verification",
            userId,
            email: `auth-outbox-failure-${userId}@example.test`,
            name: "Outbox failure user",
          }),
        /AUTH_EMAIL_ENCRYPTION_KEY or AUTH_EMAIL_ENCRYPTION_KEYS is required/,
      );
      assert.deepEqual(await db.select().from(authTokens).where(eq(authTokens.userId, userId)), []);
      assert.deepEqual(await db.select().from(authEmailOutbox).where(eq(authEmailOutbox.userId, userId)), []);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
      if (previousKey === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_KEY;
      else process.env.AUTH_EMAIL_ENCRYPTION_KEY = previousKey;
      if (previousKeys === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_KEYS;
      else process.env.AUTH_EMAIL_ENCRYPTION_KEYS = previousKeys;
    }
  });
});
