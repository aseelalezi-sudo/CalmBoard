export function enabledPublicFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export const telemetryUiEnabled = enabledPublicFlag(process.env.NEXT_PUBLIC_TELEMETRY_UI_ENABLED);
export const webAuthnUiEnabled = enabledPublicFlag(process.env.NEXT_PUBLIC_WEBAUTHN_UI_ENABLED);
