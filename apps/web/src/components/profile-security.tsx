"use client";
import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { Card, Btn, Toggle, Badge, inputCls } from "./ui";
import { IconShield } from "./icons";
import { useProfileSecurity } from "@/features/profile/use-profile-security";

export function ProfileSecurityView({ ctx }: { ctx: ViewCtx }) {
  const [activeTab, setActiveTab] = useState<"security" | "sessions" | "prefs" | "branches">("security");
  const {
    sessions,
    branches,
    preferences: prefs,
    mfa,
    deleteSessions: handleSessionDelete,
    updatePreferences: handlePrefChange,
    addBranch,
    setupMfa,
    confirmMfa,
    turnOffMfa,
  } = useProfileSecurity(ctx);

  const [showQrModal, setShowQrModal] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const enable2FA = async () => {
    try {
      const codes = await confirmMfa(totpCode);
      setShowQrModal(false);
      setMfaSetup(null);
      setTotpCode("");
      setRecoveryCodes(codes);
      ctx.notify("تم تفعيل المصادقة الثنائية (TOTP 2FA) بنجاح ✓");
    } catch (cause) {
      ctx.notify(cause instanceof Error ? cause.message : "رمز التحقق غير صحيح", "error");
    }
  };

  return (
    <div className="max-w-[920px] mx-auto space-y-6 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-white/10">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900 dark:text-white">
            {ctx.t("حسابي والأمان (Account & Security)", "My Account & Security")}
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500 dark:text-zinc-400">
            إدارة الجلسات والأجهزة، المصادقة الثنائية 2FA، مفاتيح Passkeys، ساعات عدم الإزعاج DND، وإدارة الفروع.
          </p>
        </div>
        <div className="flex gap-2">
          {[
            ["security", "🔐 المصادقة و 2FA", "Security & 2FA"],
            ["sessions", "💻 الجلسات والأجهزة", "Sessions"],
            ["prefs", "🔔 الإشعارات و DND", "Notifications & DND"],
            ["branches", "🏢 فروع المؤسسة", "Branches"],
          ].map(([k, ar, en]) => (
            <button
              key={k}
              onClick={() => setActiveTab(k as any)}
              className={`rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition ${
                activeTab === k
                  ? "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-white/4 dark:text-zinc-400 dark:hover:bg-white/10"
              }`}
            >
              {ctx.t(ar, en)}
            </button>
          ))}
        </div>
      </div>

      {/* Security & 2FA */}
      {activeTab === "security" && (
        <div className="grid gap-5 md:grid-cols-2">
          <Card className="p-6 bg-white dark:bg-white/2.5" glow>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                  <IconShield size={20} />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">المصادقة الثنائية (TOTP 2FA)</h3>
                  <p className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                    حماية حسابك عبر تطبيق Authenticator (مثل Google أو Authy).
                  </p>
                </div>
              </div>
              <Badge tone={mfa?.enabled ? "emerald" : "amber"}>{mfa?.enabled ? "مفعّل ✓" : "غير مفعّل"}</Badge>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5 dark:border-white/6">
              {mfa?.enabled ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-[12.5px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    حسابك محمي الآن بالمصادقة الثنائية. رموز الاسترداد المتبقية: {mfa.recoveryCodesRemaining}.
                  </div>
                  {recoveryCodes.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-black/40">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                        رموز الاسترداد (احتفظ بها في مكان آمن):
                      </div>
                      <div className="grid grid-cols-2 gap-2 font-mono text-[12.5px] text-indigo-600 dark:text-violet-300">
                        {recoveryCodes.map((code, idx) => (
                          <div key={idx} className="rounded bg-white p-1.5 text-center shadow-sm dark:bg-white/5">
                            {code}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Btn
                    variant="outline"
                    className="w-full text-rose-600 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-500/30"
                    onClick={async () => {
                      const code = prompt("أدخل رمز TOTP أو رمز استرداد لتعطيل المصادقة الثنائية:");
                      if (!code) return;
                      try {
                        await turnOffMfa(code.trim());
                        setRecoveryCodes([]);
                        ctx.notify("تم تعطيل المصادقة الثنائية وإنهاء الجلسات الأخرى");
                      } catch (cause) {
                        ctx.notify(cause instanceof Error ? cause.message : "تعذر تعطيل المصادقة الثنائية", "error");
                      }
                    }}
                  >
                    تعطيل المصادقة الثنائية
                  </Btn>
                </div>
              ) : (
                <div className="space-y-4 text-start">
                  <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-zinc-300">
                    يضيف TOTP 2FA طبقة أمان إضافية لحماية مؤسستك من الوصول غير المصرح به (القسم 6). عند التفعيل سنطلب
                    رمزاً مؤقتاً عند كل دخول من جهاز جديد.
                  </p>
                  <Btn
                    variant="glow"
                    className="w-full"
                    onClick={async () => {
                      try {
                        const setup = await setupMfa();
                        setMfaSetup(setup);
                        setShowQrModal(true);
                      } catch (cause) {
                        ctx.notify(cause instanceof Error ? cause.message : "تعذر بدء إعداد TOTP", "error");
                      }
                    }}
                  >
                    + إعداد المصادقة الثنائية (Setup 2FA)
                  </Btn>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-6 bg-white dark:bg-white/2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">
                  مفاتيح المرور (Passkeys / WebAuthn)
                </h3>
                <p className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                  تسجيل الدخول الفوري بأمان بيومتري (TouchID / FaceID / YubiKey).
                </p>
              </div>
              <Badge tone="amber">غير متاح حالياً</Badge>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5 text-[12.5px] leading-relaxed text-slate-500 dark:border-white/6 dark:text-zinc-400">
              لم يتم تفعيل WebAuthn في الخادم بعد، لذلك لا تعرض المنصة مفاتيح تجريبية أو زر تسجيل وهمياً. سيظهر الإعداد
              هنا بعد اكتمال دعم Passkeys الحقيقي.
            </div>
          </Card>
        </div>
      )}

      {/* Sessions & Devices */}
      {activeTab === "sessions" && (
        <Card className="p-6 bg-white dark:bg-white/2.5" glow>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-white/6">
            <div>
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">
                الأجهزة والجلسات النشطة (Active Sessions & Devices)
              </h3>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
                تدوير Refresh Tokens واكتشاف الأجهزة المتصلة بحسابك حالياً مع إمكانية إنهاء الجلسات المشبوهة (القسم 6).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sessions.length > 1 && (
                <Btn variant="danger" onClick={() => handleSessionDelete(undefined, true)}>
                  🚫 إنهاء جميع الجلسات الأخرى (Logout other sessions)
                </Btn>
              )}
              {sessions.length > 0 && (
                <Btn
                  variant="outline"
                  className="border-rose-200 text-rose-600 dark:border-rose-500/30 dark:text-rose-300"
                  onClick={() => {
                    if (confirm("سيتم تسجيل الخروج من هذا الجهاز وجميع الأجهزة الأخرى. هل تريد المتابعة؟")) {
                      void handleSessionDelete(undefined, false, true);
                    }
                  }}
                >
                  إنهاء كل الجلسات
                </Btn>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition ${s.isCurrent ? "border-indigo-500/40 bg-indigo-50/40 dark:border-indigo-500/30 dark:bg-indigo-500/8" : "border-slate-200 bg-white dark:border-white/10 dark:bg-white/2"}`}
              >
                <div className="flex items-center gap-3.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-xl dark:bg-white/5">
                    {s.device.includes("iPhone") || s.device.includes("iOS") || s.device.includes("Android")
                      ? "📱"
                      : "💻"}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-slate-900 dark:text-white">{s.device}</span>
                      {s.isCurrent && <Badge tone="cyan">هذا الجهاز (Current)</Badge>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-slate-500 dark:text-zinc-400">
                      {s.browser} • <span className="font-mono">{s.ip}</span> • {s.location} • آخر نشاط:{" "}
                      {new Date(s.lastActive).toLocaleTimeString("ar-EG")}
                    </div>
                  </div>
                </div>

                {!s.isCurrent && (
                  <button
                    onClick={() => handleSessionDelete(s.id)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  >
                    تسجيل الخروج (Revoke)
                  </button>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <p className="py-8 text-center text-[13px] text-slate-400 dark:text-zinc-500">لا توجد جلسات مسجلة.</p>
            )}
          </div>
        </Card>
      )}

      {/* Notifications & DND Hours */}
      {activeTab === "prefs" && prefs && (
        <Card className="p-6 bg-white dark:bg-white/2.5">
          <div className="border-b border-slate-100 pb-4 dark:border-white/6">
            <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">
              تفضيلات الإشعارات وساعات عدم الإزعاج (Notification Center & DND Hours)
            </h3>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
              تحديد القنوات المستلمة للإشعارات (بريد، سطح المكتب، داخل التطبيق) وتفعيل ساعات الهدوء (القسم 13).
            </p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h4 className="text-[13.5px] font-bold text-slate-900 dark:text-white">
                قنوات التسليم (Delivery Channels):
              </h4>
              {[
                ["inAppEnabled", "إشعارات داخل التطبيق (In-App Center)", prefs.inAppEnabled],
                ["emailEnabled", "إشعارات البريد الإلكتروني (Email Digest)", prefs.emailEnabled],
                ["pushEnabled", "إشعارات المتصفح وسحابة الـ Push (Desktop)", prefs.pushEnabled],
              ].map(([key, label, val]) => (
                <div
                  key={String(key)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-white/10 dark:bg-white/2"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-zinc-200">{label}</span>
                  <Toggle checked={Boolean(val)} onChange={(v) => handlePrefChange({ [key as string]: v })} />
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 dark:border-indigo-500/25 dark:bg-indigo-500/6">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[14px] font-bold text-slate-900 dark:text-white">
                    ساعات عدم الإزعاج (Do Not Disturb - DND)
                  </h4>
                  <p className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                    كتم جميع التنبيهات والأصوات خلال هذه الفترة.
                  </p>
                </div>
                <Toggle checked={prefs.dndEnabled} onChange={(v) => handlePrefChange({ dndEnabled: v })} />
              </div>

              {prefs.dndEnabled && (
                <div className="grid grid-cols-2 gap-3 pt-3 animate-fade">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                      من الساعة (Start):
                    </span>
                    <input
                      name="auto-field-tuywj4r"
                      type="time"
                      value={prefs.dndStart}
                      onChange={(e) => handlePrefChange({ dndStart: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                      إلى الساعة (End):
                    </span>
                    <input
                      name="auto-field-8wwufbm"
                      type="time"
                      value={prefs.dndEnd}
                      onChange={(e) => handlePrefChange({ dndEnd: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Multi-Branch Support */}
      {activeTab === "branches" && (
        <Card className="p-6 bg-white dark:bg-white/2.5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-white/6">
            <div>
              <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">
                إدارة فروع المؤسسة (Multi-Branch Organizations - القسم 5)
              </h3>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
                تنظيم مساحات العمل والفرق وتوزيع الموظفين عبر فروع متعددة للمؤسسات الكبرى (مثل فرع الرياض، دبي،
                القاهرة).
              </p>
            </div>
            <Btn
              variant="glow"
              onClick={() => {
                const name = prompt("اسم الفرع الجديد (مثال: المقر الإقليمي - جدة):", "فرع جدة");
                const code = prompt("رمز الفرع (مثال: JED-HQ):", "JED-REG");
                if (name) void addBranch(name, code, "جدة");
              }}
            >
              + إضافة فرع جديد (New Branch)
            </Btn>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {branches.map((br) => (
              <div
                key={br.id}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-indigo-500/40 dark:border-white/10 dark:bg-white/2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[15px] font-bold text-slate-900 dark:text-white">{br.name}</span>
                  <Badge tone="cyan">{br.code}</Badge>
                </div>
                <div className="mt-2.5 text-[12px] text-slate-500 dark:text-zinc-400">
                  <div>
                    📍 المدينة:{" "}
                    <span className="font-semibold text-slate-700 dark:text-zinc-200">{br.city || "—"}</span>
                  </div>
                  {br.address && <div className="mt-1 truncate">🏢 {br.address}</div>}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-200/60 pt-3 text-[11px] text-indigo-600 dark:border-white/10 dark:text-violet-300 font-semibold">
                  <span>مساحات العمل المرتبطة</span>
                  <span>عرض الفرع ←</span>
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <p className="col-span-3 py-8 text-center text-[13px] text-slate-400 dark:text-zinc-500">
                لا توجد فروع مضافة لهذه المؤسسة بعد.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* TOTP setup modal */}
      {showQrModal && mfaSetup && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 dark:bg-zinc-950/70 backdrop-blur-md animate-fade"
            onClick={() => {
              setShowQrModal(false);
              setMfaSetup(null);
            }}
          />
          <div className="animate-pop relative w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900/95 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
              <IconShield size={22} />
            </div>
            <h3 className="mt-4 text-[17px] font-bold text-slate-900 dark:text-white">إعداد تطبيق Authenticator</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500 dark:text-zinc-400">
              أضف الحساب في تطبيق Google Authenticator أو Authy أو 1Password باستخدام المفتاح التالي، ثم أدخل الرمز
              الحالي المكون من 6 أرقام:
            </p>

            <div className="my-5 rounded-2xl border border-indigo-400/40 bg-slate-50 p-4 dark:bg-white/5">
              <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">المفتاح اليدوي</div>
              <div className="mt-2 break-all font-mono text-sm font-bold tracking-wider text-indigo-600 dark:text-violet-300">
                {mfaSetup.secret}
              </div>
              <a
                href={mfaSetup.uri}
                className="mt-3 inline-block text-xs font-semibold text-violet-600 hover:underline dark:text-violet-300"
              >
                فتح رابط otpauth في تطبيق المصادقة
              </a>
            </div>

            <input
              name="auto-field-n6vgm3n"
              type="text"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="123456"
              className="mx-auto block w-40 text-center font-mono text-2xl font-bold tracking-widest h-12 rounded-xl border border-slate-300 bg-slate-50 text-slate-900 outline-none focus:border-indigo-600 dark:border-white/20 dark:bg-white/5 dark:text-white dark:focus:border-cyan-400"
            />

            <div className="mt-6 flex gap-2">
              <Btn variant="glow" size="lg" className="flex-1" onClick={enable2FA}>
                تأكيد وتفعيل 2FA
              </Btn>
              <Btn
                variant="outline"
                size="lg"
                onClick={() => {
                  setShowQrModal(false);
                  setMfaSetup(null);
                }}
              >
                إلغاء
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
