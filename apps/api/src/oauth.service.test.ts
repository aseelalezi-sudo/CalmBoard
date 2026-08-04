import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { OAuthService, oauthProviderAvailability, parseOAuthProvider } from "./oauth.service";

const previousGoogleFlag = process.env.AUTH_GOOGLE_OAUTH_ENABLED;
const previousMicrosoftFlag = process.env.AUTH_MICROSOFT_OAUTH_ENABLED;

afterEach(() => {
  if (previousGoogleFlag === undefined) delete process.env.AUTH_GOOGLE_OAUTH_ENABLED;
  else process.env.AUTH_GOOGLE_OAUTH_ENABLED = previousGoogleFlag;
  if (previousMicrosoftFlag === undefined) delete process.env.AUTH_MICROSOFT_OAUTH_ENABLED;
  else process.env.AUTH_MICROSOFT_OAUTH_ENABLED = previousMicrosoftFlag;
});

describe("OAuth feature flags", () => {
  it("hides both providers unless each flag is explicitly true", () => {
    process.env.AUTH_GOOGLE_OAUTH_ENABLED = "false";
    delete process.env.AUTH_MICROSOFT_OAUTH_ENABLED;
    assert.deepEqual(oauthProviderAvailability(), { google: false, microsoft: false });
    process.env.AUTH_GOOGLE_OAUTH_ENABLED = "TRUE";
    process.env.AUTH_MICROSOFT_OAUTH_ENABLED = "true";
    assert.deepEqual(oauthProviderAvailability(), { google: true, microsoft: true });
  });

  it("rejects disabled and unknown providers before creating authorization state", async () => {
    process.env.AUTH_GOOGLE_OAUTH_ENABLED = "false";
    await assert.rejects(() => new OAuthService().begin("google"), ServiceUnavailableException);
    assert.equal(parseOAuthProvider("microsoft"), "microsoft");
    assert.throws(() => parseOAuthProvider("github"), BadRequestException);
  });
});
