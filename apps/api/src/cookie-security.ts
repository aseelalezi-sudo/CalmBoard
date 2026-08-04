type CookieEnvironment = Record<string, string | undefined>;

export function secureCookieAttribute(environment: CookieEnvironment = process.env) {
  if (environment.AUTH_COOKIE_SECURE === "true") return "; Secure";
  if (environment.AUTH_COOKIE_SECURE === "false") return "";
  return environment.NODE_ENV === "production" ? "; Secure" : "";
}
