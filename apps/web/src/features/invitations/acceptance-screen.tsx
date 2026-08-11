"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthScreen } from "@/features/auth/auth-screen";
import { ApiError } from "@/lib/client-api";
import type { User } from "@/lib/types";
import { Btn, Card } from "@/components/ui";
import { LogoMark } from "@/components/icons";
import {
  acceptInvitationToken,
  declineInvitationToken,
  inspectInvitationToken,
  type InvitationInspection,
} from "./api";
import { getInvitationSession } from "./use-invitation-session";

export function InvitationAcceptanceScreen() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationInspection | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const locale = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar";
  const t = (ar: string, en: string) => (locale === "ar" ? ar : en);

  useEffect(() => {
    const rawToken = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(rawToken);
    if (!rawToken) {
      setInvitation({ status: "invalid" });
      setLoading(false);
      return;
    }
    void Promise.all([inspectInvitationToken(rawToken), getInvitationSession()])
      .then(([inspection, session]) => {
        setInvitation(inspection);
        setUser(session.user ?? null);
      })
      .catch(() => setInvitation({ status: "invalid" }))
      .finally(() => setLoading(false));
  }, []);

  const refreshSession = async () => {
    const session = await getInvitationSession();
    setUser(session.user ?? null);
  };

  const accept = async () => {
    setPending("accept");
    setError("");
    try {
      const result = await acceptInvitationToken(token);
      const query = new URLSearchParams({ view: "members" });
      if (result.workspaceId) query.set("workspaceId", result.workspaceId);
      window.history.replaceState({}, "", "/accept-invitation");
      window.location.assign(`/?${query.toString()}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("تعذر قبول الدعوة", "Could not accept invitation"));
    } finally {
      setPending(null);
    }
  };

  const decline = async () => {
    setPending("decline");
    setError("");
    try {
      await declineInvitationToken(token);
      window.history.replaceState({}, "", "/accept-invitation");
      setInvitation((current) => (current ? { ...current, status: "declined" } : current));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("تعذر رفض الدعوة", "Could not decline invitation"));
    } finally {
      setPending(null);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-slate-600 dark:text-zinc-300">
        {t("جارٍ التحقق من الدعوة…", "Checking invitation…")}
      </div>
    );
  }
  if (!invitation || ["invalid", "revoked", "expired", "accepted", "declined"].includes(invitation.status)) {
    const messages: Record<string, [string, string]> = {
      invalid: ["رابط الدعوة غير صالح.", "This invitation link is invalid."],
      revoked: ["أُلغيت هذه الدعوة.", "This invitation was revoked."],
      expired: [
        "انتهت صلاحية الدعوة. اطلب إعادة إرسالها.",
        "This invitation expired. Ask an administrator to resend it.",
      ],
      accepted: ["استُخدمت هذه الدعوة مسبقاً.", "This invitation has already been accepted."],
      declined: ["تم رفض هذه الدعوة.", "This invitation was declined."],
    };
    const message = messages[invitation?.status ?? "invalid"] ?? messages.invalid!;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-5 dark:bg-zinc-950">
        <Card className="w-full max-w-lg p-7 text-center">
          <LogoMark size={42} />
          <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">{t(message[0], message[1])}</h1>
          <Link
            href="/"
            className="mt-5 inline-block text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            {t("العودة إلى CalmBoard", "Return to CalmBoard")}
          </Link>
        </Card>
      </main>
    );
  }
  if (!user) return <AuthScreen onAuthenticated={refreshSession} />;

  const identityMatches = user.email.toLowerCase() === invitation.email?.toLowerCase();
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5 dark:bg-zinc-950">
      <Card className="w-full max-w-xl p-7">
        <div className="flex items-center gap-3">
          <LogoMark size={38} />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {t("دعوة للانضمام", "Workspace invitation")}
          </h1>
        </div>
        <div className="mt-6 space-y-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10">
          <p>
            {t("المؤسسة", "Organization")}: <strong>{invitation.organization?.name}</strong>
          </p>
          {invitation.workspace?.name && (
            <p>
              {t("مساحة العمل", "Workspace")}: <strong>{invitation.workspace.name}</strong>
            </p>
          )}
          <p>
            {t("الدور", "Role")}: <strong>{invitation.role}</strong>
          </p>
          <p>
            {t("البريد المقصود", "Invited email")}:{" "}
            <bdi dir="ltr" className="font-semibold">
              {invitation.email}
            </bdi>
          </p>
        </div>
        {!identityMatches ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {t("سجّل الدخول بالحساب المطابق للبريد المدعو.", "Sign in with the account matching the invited email.")}
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-3">
            <Btn variant="glow" disabled={pending !== null} onClick={() => void accept()}>
              {pending === "accept" ? t("جارٍ القبول…", "Accepting…") : t("قبول الدعوة", "Accept invitation")}
            </Btn>
            <Btn variant="outline" disabled={pending !== null} onClick={() => void decline()}>
              {pending === "decline" ? t("جارٍ الرفض…", "Declining…") : t("رفض", "Decline")}
            </Btn>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}
