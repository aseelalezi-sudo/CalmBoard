const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Returns a normalized URL only for web and mail links; anything else (javascript:, data:, vbscript:,
// relative or malformed values) yields undefined so user-supplied hrefs are never rendered unchecked.
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
