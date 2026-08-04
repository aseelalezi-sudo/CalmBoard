import { Injectable } from "@nestjs/common";
import { createAuthTokensRepository } from "@calmboard/database";

export type AuthEmailPurpose = "email_verification" | "password_reset";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function authUrl(path: string, token: string) {
  const url = new URL(path, process.env.APP_URL ?? "http://localhost:3000");
  url.searchParams.set("token", token);
  return url.toString();
}

@Injectable()
export class AuthEmailService {
  private readonly authTokens = createAuthTokensRepository();

  async send(input: { purpose: AuthEmailPurpose; userId: string; email: string; name: string; requestedIp?: string }) {
    const verification = input.purpose === "email_verification";
    const subject = verification ? "Verify your CalmBoard email" : "Reset your CalmBoard password";
    const action = verification ? "Verify email" : "Reset password";
    const lifetime = verification ? "24 hours" : "30 minutes";
    await this.authTokens.issueEmail(
      input.userId,
      input.purpose,
      (token) => {
        const link = authUrl(verification ? "/verify-email" : "/reset-password", token);
        return {
          to: input.email,
          name: input.name,
          subject,
          html: `<div style="font-family:sans-serif;padding:20px"><h2>${escapeHtml(subject)}</h2><p>Hello ${escapeHtml(input.name)},</p><p>This one-time link expires in ${lifetime}.</p><p><a href="${escapeHtml(link)}">${action}</a></p><p>If you did not request this, you can ignore this email.</p></div>`,
        };
      },
      input.requestedIp,
    );
    return true;
  }
}
