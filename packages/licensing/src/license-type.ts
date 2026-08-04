import type { LicenseClaims } from "./status.js";

/**
 * License categories supported by LicenseHub. These map to license `typ` claims.
 */
export type LicenseType = "trial" | "monthly" | "yearly" | "perpetual" | "unknown";

export type LicenseDescription = {
  type: LicenseType;
  label: string;
  /** ISO date string the license expires, or null for perpetual / unknown. */
  expiresAt: string | null;
  /** True for renewable subscriptions (monthly/yearly); false for trial/perpetual. */
  renews: boolean;
};

const TYPE_LABELS: Record<LicenseType, string> = {
  trial: "Trial",
  monthly: "Monthly",
  yearly: "Yearly",
  perpetual: "Perpetual",
  unknown: "Unknown",
};

function normalizeType(typ: string | undefined): LicenseType {
  if (!typ) return "unknown";
  const value = typ.toLowerCase().replace(/[^a-z]/g, "");
  if (["trial", "trialperiod", "evaluation"].includes(value)) return "trial";
  if (["monthly", "subscriptionmonthly", "month"].includes(value)) return "monthly";
  if (["yearly", "subscriptionyearly", "annual", "year"].includes(value)) return "yearly";
  if (["perpetual", "lifetime", "onetime", "forever", "unlimited"].includes(value)) return "perpetual";
  return "unknown";
}

/** Infer an expiry timestamp from claims, honoring the explicit `exp` future date. */
function inferExpiresAt(claims: LicenseClaims): { timestamp: number | null; explicit: boolean } {
  const type = normalizeType(claims.typ);
  const now = Date.now() / 1000;

  if (typeof claims.exp === "number") {
    // perpetual licenses carry exp = 0 or a very distant date
    if (claims.exp >= 4102444800) return { timestamp: null, explicit: false }; // >= year 2100
    if (claims.exp > now) return { timestamp: claims.exp, explicit: true };
    return { timestamp: claims.exp, explicit: true };
  }

  if (type === "monthly") {
    const iat = claims.iat ?? now;
    return { timestamp: iat + 31 * 86400, explicit: false };
  }
  if (type === "yearly") {
    const iat = claims.iat ?? now;
    return { timestamp: iat + 365 * 86400, explicit: false };
  }

  return { timestamp: null, explicit: false };
}

/**
 * Classify a token's claims into a human-friendly license type.
 */
export function describeLicense(claims: LicenseClaims): LicenseDescription {
  const type = normalizeType(claims.typ);
  const { timestamp } = inferExpiresAt(claims);

  const renews = type === "monthly" || type === "yearly";

  return {
    type,
    label: TYPE_LABELS[type],
    expiresAt: timestamp === null ? null : new Date(timestamp * 1000).toISOString(),
    renews,
  };
}

/** Narrow helper: cheap boolean accessor for feature gating. */
export function isType(claims: LicenseClaims, type: LicenseType): boolean {
  return normalizeType(claims.typ) === type;
}
