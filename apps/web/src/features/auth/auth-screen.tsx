"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/icons";
import { Btn, inputCls, SegmentedTabs } from "@/components/ui";
import { useUiStore } from "@/lib/stores/ui-store";
import { useAuthOperations } from "./use-auth-operations";
import { oauthProviders, oauthStartUrl } from "./api";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const { forgotPassword, login, register, verifyMfaLogin, verifyOAuthMfaLogin } = useAuthOperations();
  const locale = useUiStore((state) => state.locale);
  const t = useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [oauthMfa, setOauthMfa] = useState(false);
  const [providers, setProviders] = useState({ google: false, microsoft: false });
  const mfaPending = Boolean(mfaChallenge) || oauthMfa;

  useEffect(() => {
    void oauthProviders()
      .then(setProviders)
      .catch(() => setProviders({ google: false, microsoft: false }));
    const query = new URLSearchParams(window.location.search);
    if (query.get("oauth_mfa") === "1") {
      setOauthMfa(true);
      setNotice(
        t(
          "أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد لإكمال تسجيل الدخول الخارجي.",
          "Enter your authenticator or recovery code to complete sign in.",
        ),
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      if (mfaPending) {
        if (oauthMfa) await verifyOAuthMfaLogin(String(data.get("code")));
        else await verifyMfaLogin(mfaChallenge, String(data.get("code")));
        await onAuthenticated();
      } else if (mode === "forgot") {
        await forgotPassword(String(data.get("email")));
        setNotice(
          t(
            "إذا كان الحساب موجوداً فستصلك رسالة استعادة كلمة المرور خلال دقائق.",
            "If an account exists, a password recovery message has been sent.",
          ),
        );
      } else if (mode === "login") {
        const result = await login({ email: String(data.get("email")), password: String(data.get("password")) });
        if (result.requiresMfa) {
          setMfaChallenge(result.challengeToken);
          setNotice(
            t("أدخل رمز التحقق بخطوتين من تطبيق المصادقة.", "Enter two-factor authentication code from your app."),
          );
          return;
        }
        await onAuthenticated();
      } else {
        const password = String(data.get("password"));
        const passwordConfirmation = String(data.get("passwordConfirmation"));
        if (password !== passwordConfirmation) {
          setError(t("كلمتا المرور غير متطابقتين.", "Passwords do not match."));
          return;
        }
        await register({
          email: String(data.get("email")),
          password,
          name: String(data.get("name")),
          organizationName: String(data.get("organizationName")),
          workspaceName: String(data.get("workspaceName")),
        });
        await onAuthenticated();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("تعذر إكمال المصادقة", "Authentication could not be completed"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-bg grid min-h-dvh place-items-center px-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-7 text-ink shadow-2xl backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <h1 className="font-display text-xl font-bold text-ink">CalmBoard</h1>
            <p className="text-xs text-ink-faint">
              {mfaPending
                ? t("التحقق بخطوتين", "Two-factor authentication")
                : mode === "forgot"
                  ? t("استعادة كلمة المرور", "Password recovery")
                  : t("إدارة العمل بهدوء ووضوح", "Calm, focused project management")}
            </p>
          </div>
        </div>

        {!mfaPending && mode !== "forgot" && (
          <div className="mb-6">
            <SegmentedTabs
              label={t("طريقة المصادقة", "Authentication method")}
              value={mode}
              onChange={(v) => {
                setMode(v as "login" | "register");
                setMfaChallenge("");
                setError("");
                setNotice("");
              }}
              items={[
                { id: "login", label: t("تسجيل الدخول", "Sign in") },
                { id: "register", label: t("إنشاء حساب", "Create account") },
              ]}
            />
          </div>
        )}

        <form className="space-y-4" onSubmit={submit}>
          {mfaPending ? (
            <Field
              name="code"
              label={t("رمز المصادقة أو الاسترداد", "Auth or recovery code")}
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
            />
          ) : mode === "register" ? (
            <>
              <Field name="name" label={t("الاسم", "Name")} autoComplete="name" />
              <Field
                name="organizationName"
                label={t("اسم المؤسسة", "Organization name")}
                autoComplete="organization"
              />
              <Field name="workspaceName" label={t("اسم مساحة العمل", "Workspace name")} autoComplete="off" />
            </>
          ) : null}

          {!mfaPending && (
            <Field name="email" label={t("البريد الإلكتروني", "Email address")} type="email" autoComplete="email" />
          )}

          {!mfaPending && mode !== "forgot" && (
            <>
              <Field
                name="password"
                label={t("كلمة المرور", "Password")}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={12}
              />
              {mode === "register" && (
                <Field
                  name="passwordConfirmation"
                  label={t("تأكيد كلمة المرور", "Confirm password")}
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                />
              )}
            </>
          )}

          {mode === "register" && (
            <p className="text-[11px] text-ink-faint">
              {t("استخدم 12 حرفاً على الأقل.", "Use at least 12 characters.")}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
            >
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="h-11 w-full rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-[0_6px_22px_rgba(99,102,241,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {pending
              ? t("جارٍ التحقق…", "Checking…")
              : mfaPending
                ? t("تحقق ودخول", "Verify and sign in")
                : mode === "login"
                  ? t("تسجيل الدخول", "Sign in")
                  : mode === "register"
                    ? t("إنشاء حساب", "Create account")
                    : t("إرسال رابط استعادة كلمة المرور", "Send recovery link")}
          </button>

          {!mfaPending && mode === "login" && (
            <button
              type="button"
              className="w-full text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => {
                setMode("forgot");
                setError("");
                setNotice("");
              }}
            >
              {t("نسيت كلمة المرور؟", "Forgot your password?")}
            </button>
          )}

          {!mfaPending && mode === "forgot" && (
            <button
              type="button"
              className="w-full text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
            >
              {t("العودة لتسجيل الدخول", "Back to sign in")}
            </button>
          )}

          {mfaPending && (
            <button
              type="button"
              className="w-full text-xs text-accent hover:underline"
              onClick={() => {
                setMfaChallenge("");
                setOauthMfa(false);
                setNotice("");
                setError("");
              }}
            >
              {t("العودة إلى كلمة المرور", "Return to password")}
            </button>
          )}
        </form>

        {!mfaPending && mode === "login" && (providers.google || providers.microsoft) && (
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-center text-[11px] text-ink-faint">
              {t("أو تابع عبر مزود موثوق", "Or continue with a trusted provider")}
            </p>
            <div className="grid gap-2">
              {providers.google && (
                <Btn
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => window.location.assign(oauthStartUrl("google"))}
                  className="w-full"
                >
                  {t("المتابعة باستخدام Google", "Continue with Google")}
                </Btn>
              )}
              {providers.microsoft && (
                <Btn
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => window.location.assign(oauthStartUrl("microsoft"))}
                  className="w-full"
                >
                  {t("المتابعة باستخدام Microsoft", "Continue with Microsoft")}
                </Btn>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Field({
  label,
  ...input
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  inputMode?: "text" | "numeric" | "search" | "email" | "tel" | "url" | "none" | "decimal";
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-xs font-medium text-ink-soft">
      <span className="mb-1.5 block">{label}</span>
      <input {...input} id={input.name} required className={`${inputCls} h-11 text-sm`} />
    </label>
  );
}
