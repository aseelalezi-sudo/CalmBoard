export function apiSecurityHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(env.NODE_ENV === "production" && env.AUTH_COOKIE_SECURE !== "false"
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}
