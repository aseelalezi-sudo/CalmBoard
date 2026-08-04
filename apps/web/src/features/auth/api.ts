import type { User } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & {
  name: string;
  organizationName: string;
  workspaceName: string;
};

export type LoginResult =
  { requiresMfa: false; user: User } | { requiresMfa: true; challengeToken: string; challengeExpiresAt: string };

export function login(input: LoginInput) {
  return requestJson<LoginResult>(apiServiceUrl("/auth/login"), jsonRequest("POST", input));
}

export function verifyMfaLogin(challengeToken: string, code: string) {
  return requestJson<{ user: User }>(apiServiceUrl("/auth/mfa/verify"), jsonRequest("POST", { challengeToken, code }));
}

export function oauthProviders() {
  return requestJson<{ google: boolean; microsoft: boolean }>(apiServiceUrl("/auth/oauth/providers"));
}

export function oauthStartUrl(provider: "google" | "microsoft") {
  return apiServiceUrl(`/auth/oauth/${provider}/start`);
}

export function verifyOAuthMfaLogin(code: string) {
  return requestJson<{ user: User }>(apiServiceUrl("/auth/oauth/mfa/verify"), jsonRequest("POST", { code }));
}

export function register(input: RegisterInput) {
  return requestJson<{ user: User }>(apiServiceUrl("/auth/register"), jsonRequest("POST", input));
}

export function logout() {
  return requestJson<{ ok: true }>(apiServiceUrl("/auth/logout"), jsonRequest("POST", {}));
}

export function requestEmailVerification(email: string) {
  return requestJson<{ ok: true; message: string }>(
    apiServiceUrl("/auth/email/verification/request"),
    jsonRequest("POST", { email }),
  );
}

export function verifyEmail(token: string) {
  return requestJson<{ ok: true; emailVerifiedAt: string }>(
    apiServiceUrl("/auth/email/verify"),
    jsonRequest("POST", { token }),
  );
}

export function forgotPassword(email: string) {
  return requestJson<{ ok: true; message: string }>(
    apiServiceUrl("/auth/password/forgot"),
    jsonRequest("POST", { email }),
  );
}

export function resetPassword(token: string, password: string) {
  return requestJson<{ ok: true }>(apiServiceUrl("/auth/password/reset"), jsonRequest("POST", { token, password }));
}
