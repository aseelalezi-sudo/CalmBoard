"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthScreen } from "@/features/auth/auth-screen";
import { useAuthOperations } from "@/features/auth/use-auth-operations";
import { ApiError } from "@/lib/client-api";
import type { User } from "@/lib/types";
import { Btn, Card, ScreenState } from "@/components/ui";
import { IconRotateCw, LogoMark } from "@/components/icons";
import { confirmAction } from "@/components/feedback";
import {
  acceptInvitationToken,
  declineInvitationToken,
  inspectInvitationToken,
  type InvitationInspection,
} from "./api";
import { getInvitationSession } from "./use-invitation-session";

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface p-5">
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}

export function InvitationAcceptanceScreen() {
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationInspection | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const { logout } = useAuthOperations();

  const locale = typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar";
  const t = useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);

  useEffect(() => {
    let current = true;
    const rawToken = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(rawToken);
    if (!rawToken) {
      setInvitation({ status: "invalid" });
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const inspection = await inspectInvitationToken(rawToken);
        if (!current) return;
        setInvitation(inspection);
        const session = await getInvitationSession();
        if (!current) return;
        setUser(session.user ?? null);
      } catch (caught) {
        if (!current) return;
        const readableError =
          caught instanceof Error ? caught.message : t("تعذر التحقق من الدعوة", "Could not verify invitation");
        setLoadError(readableError);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [reloadKey, t]);

  const refreshSession = async () => {
    const session = await getInvitationSession();
    setUser(session.user ?? null);
  };

  const switchAccount = async () => {
    await logout();
    setUser(null);
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
    const confirmed = await confirmAction({
      title: t("رفض الدعوة", "Decline invitation"),
      message: t(
        "هل أنت متأكد من رفض هذه الدعوة؟ لن تتمكن من الانضمام لمساحة العمل بهذا الرابط مجدداً.",
        "Are you sure you want to decline this invitation? You will not be able to join using this link again.",
      ),
      tone: "danger",
    });
    if (!confirmed) return;

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
      <PublicShell>
        <Card className="bg-surface p-7 text-center">
          <ScreenState
            framed={false}
            tone="loading"
            title={t("جارٍ التحقق من الدعوة…", "Checking invitation…")}
            description={t("يرجى الانتظار بينما نتحقق من صلاحية الرابط.", "Validating your invitation link.")}
          />
        </Card>
      </PublicShell>
    );
  }

  if (loadError) {
    return (
      <PublicShell>
        <Card className="bg-surface p-7 text-center">
          <ScreenState
            framed={false}
            tone="error"
            title={t("تعذر التحقق من الدعوة", "Could not verify invitation")}
            description={loadError}
            action={
              <Btn variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
                <IconRotateCw size={14} />
                {t("إعادة المحاولة", "Retry")}
              </Btn>
            }
          />
        </Card>
      </PublicShell>
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
      <PublicShell>
        <Card className="bg-surface p-7 text-center">
          <div className="flex justify-center">
            <LogoMark size={42} />
          </div>
          <h1 className="mt-5 text-xl font-bold text-ink">{t(message[0], message[1])}</h1>
          <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent hover:underline">
            {t("العودة إلى CalmBoard", "Return to CalmBoard")}
          </Link>
        </Card>
      </PublicShell>
    );
  }

  if (!user) return <AuthScreen onAuthenticated={refreshSession} />;

  const identityMatches = user.email.toLowerCase() === invitation.email?.toLowerCase();
  return (
    <PublicShell>
      <Card className="bg-surface p-7">
        <div className="flex items-center gap-3">
          <LogoMark size={38} />
          <h1 className="text-xl font-bold text-ink">{t("دعوة للانضمام", "Workspace invitation")}</h1>
        </div>
        <div className="mt-6 space-y-3 rounded-xl border border-line bg-raised/40 p-4 text-sm">
          <p>
            {t("المؤسسة", "Organization")}: <strong className="text-ink">{invitation.organization?.name}</strong>
          </p>
          {invitation.workspace?.name && (
            <p>
              {t("مساحة العمل", "Workspace")}: <strong className="text-ink">{invitation.workspace.name}</strong>
            </p>
          )}
          <p>
            {t("الدور", "Role")}: <strong className="text-ink">{invitation.role}</strong>
          </p>
          <p>
            {t("البريد المقصود", "Invited email")}:{" "}
            <bdi dir="ltr" className="font-semibold text-ink">
              {invitation.email}
            </bdi>
          </p>
        </div>
        {!identityMatches ? (
          <div className="mt-4 space-y-3">
            <p
              role="alert"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
            >
              {t(
                `أنت مسجل الدخول حالياً بحساب (${user.email})، لكن الدعوة موجهة إلى (${invitation.email}).`,
                `You are signed in as (${user.email}), but the invitation was sent to (${invitation.email}).`,
              )}
            </p>
            <Btn variant="outline" size="sm" onClick={() => void switchAccount()}>
              {t("تبديل الحساب", "Switch account")}
            </Btn>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-3">
            <Btn
              variant="glow"
              disabled={pending !== null}
              aria-busy={pending === "accept"}
              onClick={() => void accept()}
            >
              {pending === "accept" ? t("جارٍ القبول…", "Accepting…") : t("قبول الدعوة", "Accept invitation")}
            </Btn>
            <Btn
              variant="outline"
              disabled={pending !== null}
              aria-busy={pending === "decline"}
              onClick={() => void decline()}
            >
              {pending === "decline" ? t("جارٍ الرفض…", "Declining…") : t("رفض", "Decline")}
            </Btn>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </Card>
    </PublicShell>
  );
}
