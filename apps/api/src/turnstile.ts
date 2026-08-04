import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

const verificationEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const developmentSiteKey = "1x00000000000000000000AA";
const developmentSecretKey = "1x0000000000000000000000000000000AA";

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

function configuredKeys(environment: Environment) {
  const development = environment.NODE_ENV !== "production";
  return {
    siteKey: environment.TURNSTILE_SITE_KEY || (development ? developmentSiteKey : undefined),
    secretKey: environment.TURNSTILE_SECRET_KEY || (development ? developmentSecretKey : undefined),
  };
}

export function publicTurnstileConfiguration(enabled: boolean, environment: Environment = process.env) {
  if (!enabled) return { enabled: false as const };
  const { siteKey } = configuredKeys(environment);
  return { enabled: true as const, siteKey: siteKey ?? null, configured: Boolean(siteKey) };
}

export async function verifyTurnstileToken(
  enabled: boolean,
  token: string,
  remoteIp?: string,
  fetcher: Fetcher = fetch,
  environment: Environment = process.env,
) {
  if (!enabled) return;
  const { secretKey, siteKey } = configuredKeys(environment);
  if (!secretKey || !siteKey) {
    throw new ServiceUnavailableException("CAPTCHA is not configured");
  }
  if (!token || token.length > 2048) throw new BadRequestException("CAPTCHA verification is required");

  const payload = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) payload.set("remoteip", remoteIp);
  let response: Response;
  try {
    response = await fetcher(verificationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: payload,
      signal: AbortSignal.timeout(7_000),
    });
  } catch {
    throw new ServiceUnavailableException("CAPTCHA verification is temporarily unavailable");
  }
  if (!response.ok) throw new ServiceUnavailableException("CAPTCHA verification is temporarily unavailable");

  let result: TurnstileResult;
  try {
    result = (await response.json()) as TurnstileResult;
  } catch {
    throw new ServiceUnavailableException("CAPTCHA verification returned an invalid response");
  }
  if (!result.success) throw new BadRequestException("CAPTCHA verification failed");

  if (environment.NODE_ENV === "production") {
    if (result.action && result.action !== "form_submit") {
      throw new BadRequestException("CAPTCHA action does not match");
    }
    const expectedHostnames = (environment.TURNSTILE_EXPECTED_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean);
    if (expectedHostnames.length && (!result.hostname || !expectedHostnames.includes(result.hostname.toLowerCase()))) {
      throw new BadRequestException("CAPTCHA hostname does not match");
    }
  }
}
