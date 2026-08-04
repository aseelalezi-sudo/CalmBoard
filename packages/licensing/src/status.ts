/**
 * Licensing status for this installation as seen by the application.
 */
export type LicenseStatus =
  | "valid"
  | "grace_period"
  | "grace_expired"
  | "not_activated"
  | "invalid"
  | "invalid_token"
  | "revoked"
  | "expired"
  | "offline"
  | "activation_failed"
  | "error";

/** Decoded claims carried by a signed LicenseHub token. */
export type LicenseClaims = {
  iss?: string;
  sub?: string;
  dev?: string;
  devf?: string;
  prd?: string;
  cus?: string;
  typ?: string;
  fea?: string[];
  mxs?: number;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
};

/** The outcome of a licensing check handed to the application layer. */
export type LicenseCheck = {
  status: LicenseStatus;
  reason: string;
  claims: LicenseClaims;
  token: string | null;
  valid: boolean;
  /** True while the license is being honored because it is inside its offline grace window. */
  grace?: boolean;
};

export function validCheck(claims: LicenseClaims, token: string): LicenseCheck {
  return { status: "valid", reason: "ok", claims, token, valid: true, grace: false };
}

export function failedCheck(status: LicenseStatus, reason: string): LicenseCheck {
  return { status, reason, claims: {}, token: null, valid: false, grace: false };
}

/** A license inside its offline grace window: honored now, but needs a revalidation soon. */
export function graceCheck(claims: LicenseClaims, token: string, reason = "Offline grace period."): LicenseCheck {
  return { status: "grace_period", reason, claims, token, valid: true, grace: true };
}
