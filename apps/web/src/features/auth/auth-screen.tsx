"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/icons";
import { useAuthOperations } from "./use-auth-operations";
import { oauthProviders, oauthStartUrl } from "./api";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const { forgotPassword, login, register, verifyMfaLogin, verifyOAuthMfaLogin } = useAuthOperations();
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
      setNotice("أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد لإكمال تسجيل الدخول الخارجي.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
        setNotice("إذا كان الحساب موجوداً فستصلك رسالة إعادة التعيين خلال دقائق.");
      } else if (mode === "login") {
        const result = await login({ email: String(data.get("email")), password: String(data.get("password")) });
        if (result.requiresMfa) {
          setMfaChallenge(result.challengeToken);
          setNotice("أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد.");
          return;
        }
        await onAuthenticated();
      } else {
        await register({
          email: String(data.get("email")),
          password: String(data.get("password")),
          name: String(data.get("name")),
          organizationName: String(data.get("organizationName")),
          workspaceName: String(data.get("workspaceName")),
        });
        await onAuthenticated();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إكمال المصادقة");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-bg grid min-h-screen place-items-center px-4" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-7 text-slate-900 shadow-2xl shadow-indigo-950/10 backdrop-blur-xl dark:border-white/10 dark:bg-[#101019]/95 dark:text-zinc-100 dark:shadow-black/30">
        <div className="mb-7 flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">CalmBoard</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-500">إدارة العمل بهدوء ووضوح</p>
          </div>
        </div>

        {!mfaPending && (
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm dark:bg-white/5">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setMfaChallenge("");
                  setError("");
                  setNotice("");
                }}
                className={`rounded-lg px-3 py-2 transition ${mode === value ? "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/4 dark:hover:text-white"}`}
              >
                {value === "login" ? "تسجيل الدخول" : "إنشاء حساب"}
              </button>
            ))}
          </div>
        )}

        <form className="space-y-4" onSubmit={submit}>
          {mfaPending ? (
            <Field name="code" label="رمز المصادقة أو الاسترداد" autoComplete="one-time-code" />
          ) : mode === "register" ? (
            <>
              <Field name="name" label="الاسم" autoComplete="name" />
              <Field name="organizationName" label="اسم المؤسسة" autoComplete="organization" />
              <Field name="workspaceName" label="اسم مساحة العمل" autoComplete="off" />
            </>
          ) : null}
          {!mfaPending && <Field name="email" label="البريد الإلكتروني" type="email" autoComplete="email" />}
          {!mfaPending && mode !== "forgot" && (
            <Field
              name="password"
              label="كلمة المرور"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={12}
            />
          )}
          {mode === "register" && (
            <p className="text-[11px] text-slate-500 dark:text-zinc-500">استخدم 12 حرفاً على الأقل.</p>
          )}
          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              {notice}
            </p>
          )}
          <button
            disabled={pending}
            className="h-11 w-full rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-[0_6px_22px_rgba(99,102,241,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {pending
              ? "جارٍ التحقق…"
              : mfaPending
                ? "تحقق ودخول"
                : mode === "login"
                  ? "دخول"
                  : mode === "register"
                    ? "إنشاء الحساب"
                    : "إرسال رابط إعادة التعيين"}
          </button>
          {!mfaPending && mode === "login" && (
            <button
              type="button"
              className="w-full text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
              onClick={() => setMode("forgot")}
            >
              نسيت كلمة المرور؟
            </button>
          )}
          {!mfaPending && mode === "forgot" && (
            <button
              type="button"
              className="w-full text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
              onClick={() => setMode("login")}
            >
              العودة إلى تسجيل الدخول
            </button>
          )}
          {mfaPending && (
            <button
              type="button"
              className="w-full text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
              onClick={() => {
                setMfaChallenge("");
                setOauthMfa(false);
                setNotice("");
                setError("");
              }}
            >
              العودة إلى كلمة المرور
            </button>
          )}
        </form>
        {!mfaPending && mode === "login" && (providers.google || providers.microsoft) && (
          <div className="mt-6 border-t border-slate-200 pt-5 dark:border-white/10">
            <p className="mb-3 text-center text-[11px] text-slate-500 dark:text-zinc-500">أو تابع عبر مزود موثوق</p>
            <div className="grid gap-2">
              {providers.google && (
                <button
                  type="button"
                  onClick={() => window.location.assign(oauthStartUrl("google"))}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-white/4 dark:text-zinc-200 dark:hover:bg-white/8"
                >
                  المتابعة باستخدام Google
                </button>
              )}
              {providers.microsoft && (
                <button
                  type="button"
                  onClick={() => window.location.assign(oauthStartUrl("microsoft"))}
                  className="h-10 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 dark:border-white/10 dark:bg-white/4 dark:text-zinc-200 dark:hover:bg-white/8"
                >
                  المتابعة باستخدام Microsoft
                </button>
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
}) {
  return (
    <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300">
      <span className="mb-1.5 block">{label}</span>
      <input
        {...input}
        id={input.name}
        required
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/4 dark:text-white dark:placeholder:text-zinc-700 dark:focus:border-violet-400/50"
      />
    </label>
  );
}
