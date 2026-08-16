"use client";
import { useState } from "react";
import { fmtNumber, type ViewCtx } from "@/lib/types";
import { Badge, Btn, Card, inputCls, Modal, ScreenHeader, ScreenState, SegmentedTabs, Toggle } from "./ui";
import { IconBell, IconClock, IconSettings, IconShield, IconUsers } from "./icons";
import { useProfileSecurity } from "@/features/profile/use-profile-security";
import { webAuthnUiEnabled } from "@/lib/feature-flags";
import { AccountLifecycleCard } from "@/features/data-lifecycle/lifecycle-cards";
import { confirmAction, promptAction } from "@/components/feedback";

export function ProfileSecurityView({ ctx }: { ctx: ViewCtx }) {
  const [activeTab, setActiveTab] = useState<"security" | "sessions" | "prefs" | "branches" | "lifecycle">("security");
  const {
    sessions,
    branches,
    preferences: prefs,
    loading,
    loadError,
    pendingAction,
    mfa,
    reload,
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
  const closeMfaSetup = () => {
    setShowQrModal(false);
    setMfaSetup(null);
    setTotpCode("");
  };

  const enable2FA = async () => {
    const codes = await confirmMfa(totpCode);
    if (!codes) return;
    setShowQrModal(false);
    setMfaSetup(null);
    setTotpCode("");
    setRecoveryCodes(codes);
    ctx.notify("تم تفعيل المصادقة الثنائية بنجاح.");
  };

  if (loading) {
    return <ScreenState tone="loading" title={ctx.t("جاري تحميل إعدادات الحساب…", "Loading account settings…")} />;
  }

  if (loadError) {
    return (
      <ScreenState
        tone="error"
        icon={<IconShield size={20} />}
        title={ctx.t("تعذر تحميل الحساب والأمان", "Account and security could not be loaded")}
        description={loadError}
        action={<Btn onClick={() => void reload()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  return (
    <div className="page-focused space-y-5 animate-fade">
      <ScreenHeader
        title={ctx.t("حسابي والأمان", "My Account & Security")}
        description={ctx.t(
          webAuthnUiEnabled
            ? "إدارة الجلسات والمصادقة الثنائية ومفاتيح المرور والتنبيهات ودورة حياة الحساب."
            : "إدارة الجلسات والمصادقة الثنائية والتنبيهات ودورة حياة الحساب.",
          webAuthnUiEnabled
            ? "Manage sessions, two-factor authentication, passkeys, notifications, and the account lifecycle."
            : "Manage sessions, two-factor authentication, notifications, and the account lifecycle.",
        )}
        icon={<IconShield size={20} />}
      />
      <SegmentedTabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as typeof activeTab)}
        label={ctx.t("أقسام الحساب والأمان", "Account and security sections")}
        items={[
          { value: "security", label: ctx.t("المصادقة الثنائية", "Security & 2FA"), icon: <IconShield size={14} /> },
          { value: "sessions", label: ctx.t("الجلسات", "Sessions"), icon: <IconClock size={14} /> },
          { value: "prefs", label: ctx.t("الإشعارات", "Notifications"), icon: <IconBell size={14} /> },
          { value: "branches", label: ctx.t("فروع المؤسسة", "Branches"), icon: <IconUsers size={14} /> },
          {
            value: "lifecycle",
            label: ctx.t("دورة حياة الحساب", "Account lifecycle"),
            icon: <IconSettings size={14} />,
          },
        ]}
      />

      {/* Security & 2FA */}
      {activeTab === "security" && (
        <div className={`grid gap-5 ${webAuthnUiEnabled ? "md:grid-cols-2" : ""}`}>
          <Card className="p-4 sm:p-6" glow>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-md">
                  <IconShield size={20} />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold text-ink">المصادقة الثنائية</h3>
                  <p className="text-[11.5px] text-ink-faint">
                    حماية حسابك عبر تطبيق مصادقة مثل Google Authenticator أو Authy.
                  </p>
                </div>
              </div>
              <Badge tone={mfa?.enabled ? "emerald" : "amber"}>{mfa?.enabled ? "مفعّل ✓" : "غير مفعّل"}</Badge>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5 dark:border-white/6">
              {mfa?.enabled ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-[12.5px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    حسابك محمي الآن بالمصادقة الثنائية. رموز الاسترداد المتبقية:{" "}
                    {fmtNumber(mfa.recoveryCodesRemaining, ctx.locale)}.
                  </div>
                  {recoveryCodes.length > 0 && (
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                        رموز الاسترداد (احتفظ بها في مكان آمن):
                      </div>
                      <div className="grid gap-2 font-mono text-[12.5px] text-indigo-600 sm:grid-cols-2 dark:text-violet-300">
                        {recoveryCodes.map((code, idx) => (
                          <div key={idx} className="rounded border border-line bg-surface p-1.5 text-center">
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
                      const code = await promptAction({
                        title: ctx.t("تعطيل المصادقة الثنائية", "Disable two-factor authentication"),
                        message: ctx.t(
                          "سيؤدي التعطيل إلى إنهاء الجلسات الأخرى. أدخل رمزاً صالحاً للمتابعة.",
                          "Disabling 2FA will end other sessions. Enter a valid code to continue.",
                        ),
                        label: ctx.t("رمز TOTP أو رمز الاسترداد", "TOTP or recovery code"),
                        type: "password",
                        inputMode: "numeric",
                        confirmLabel: ctx.t("تعطيل 2FA", "Disable 2FA"),
                      });
                      if (!code) return;
                      if (await turnOffMfa(code.trim())) {
                        setRecoveryCodes([]);
                        ctx.notify("تم تعطيل المصادقة الثنائية وإنهاء الجلسات الأخرى.");
                      }
                    }}
                    disabled={pendingAction !== null}
                  >
                    تعطيل المصادقة الثنائية
                  </Btn>
                </div>
              ) : (
                <div className="space-y-4 text-start">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    تضيف المصادقة الثنائية طبقة أمان إضافية لحماية مؤسستك من الوصول غير المصرح به (القسم 6). عند التفعيل
                    سنطلب رمزاً مؤقتاً عند كل دخول من جهاز جديد.
                  </p>
                  <Btn
                    variant="glow"
                    className="w-full"
                    onClick={async () => {
                      const setup = await setupMfa();
                      if (!setup) return;
                      setMfaSetup(setup);
                      setShowQrModal(true);
                    }}
                    disabled={pendingAction !== null}
                  >
                    + إعداد المصادقة الثنائية
                  </Btn>
                </div>
              )}
            </div>
          </Card>

          {webAuthnUiEnabled && (
            <Card className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-bold text-ink">مفاتيح المرور</h3>
                  <p className="text-[11.5px] text-ink-faint">
                    تسجيل الدخول الفوري بأمان عبر البصمة أو التعرّف على الوجه أو مفتاح أمان.
                  </p>
                </div>
                <Badge tone="amber">غير متاح حالياً</Badge>
              </div>

              <div className="mt-6 border-t border-line pt-5 text-[12.5px] leading-relaxed text-ink-soft">
                لم تُفعّل مفاتيح المرور في الخادم بعد، لذلك لا تعرض المنصة مفاتيح تجريبية أو زر تسجيل وهمياً. سيظهر
                الإعداد هنا بعد اكتمال دعمها الحقيقي.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Sessions & Devices */}
      {activeTab === "sessions" && (
        <Card className="p-4 sm:p-6" glow>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
            <div>
              <h3 className="text-[16px] font-bold text-ink">الأجهزة والجلسات النشطة</h3>
              <p className="mt-1 text-[12px] text-ink-faint">
                تدوير رموز تجديد الجلسة واكتشاف الأجهزة المتصلة بحسابك حالياً مع إمكانية إنهاء الجلسات المشبوهة (القسم
                6).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sessions.length > 1 && (
                <Btn
                  variant="danger"
                  disabled={pendingAction !== null}
                  onClick={async () => {
                    const confirmed = await confirmAction({
                      title: ctx.t("إنهاء الجلسات الأخرى", "End other sessions"),
                      message: ctx.t(
                        "سيتم تسجيل خروج جميع الأجهزة الأخرى مع إبقاء هذا الجهاز متصلاً.",
                        "Every other device will be signed out while this device stays connected.",
                      ),
                      confirmLabel: ctx.t("إنهاء الجلسات الأخرى", "End other sessions"),
                      tone: "warning",
                    });
                    if (confirmed) await handleSessionDelete(undefined, true);
                  }}
                >
                  إنهاء جميع الجلسات الأخرى
                </Btn>
              )}
              {sessions.length > 0 && (
                <Btn
                  variant="outline"
                  disabled={pendingAction !== null}
                  className="border-rose-200 text-rose-600 dark:border-rose-500/30 dark:text-rose-300"
                  onClick={async () => {
                    if (
                      await confirmAction({
                        title: ctx.t("إنهاء كل الجلسات", "End all sessions"),
                        message: ctx.t(
                          "سيتم تسجيل خروجك من هذا الجهاز وجميع الأجهزة الأخرى، وستحتاج إلى تسجيل الدخول مجدداً.",
                          "You will be signed out from this device and every other device, and will need to sign in again.",
                        ),
                        confirmLabel: ctx.t("إنهاء الجلسات", "End sessions"),
                        tone: "danger",
                      })
                    ) {
                      await handleSessionDelete(undefined, false, true);
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
                className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition ${s.isCurrent ? "border-accent/35 bg-accent/5" : "border-line bg-raised/40"}`}
              >
                <div className="flex items-center gap-3.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-raised text-ink-soft">
                    <IconShield size={17} />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-ink">{s.device}</span>
                      {s.isCurrent && <Badge tone="cyan">هذا الجهاز</Badge>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-ink-faint">
                      {s.browser || ctx.t("متصفح غير معروف", "Unknown browser")} ·{" "}
                      <bdi dir="ltr" className="font-mono">
                        {s.ip || "—"}
                      </bdi>{" "}
                      · {s.location || ctx.t("موقع غير معروف", "Unknown location")} · {ctx.t("آخر نشاط", "Last active")}
                      :{" "}
                      {new Date(s.lastActive).toLocaleTimeString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>

                {!s.isCurrent && (
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => void handleSessionDelete(s.id)}
                    className="min-h-10 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 text-[12px] font-semibold text-rose-700 hover:bg-rose-500/15 focus-ring disabled:opacity-50 dark:text-rose-300"
                  >
                    تسجيل الخروج
                  </button>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <ScreenState
                framed={false}
                title="لا توجد جلسات مسجلة"
                description="لم يعثر الخادم على جلسات نشطة لهذا الحساب."
              />
            )}
          </div>
        </Card>
      )}

      {/* Notifications & DND Hours */}
      {activeTab === "prefs" && prefs && (
        <Card className="p-4 sm:p-6">
          <div className="border-b border-line pb-4">
            <h3 className="text-[16px] font-bold text-ink">تفضيلات الإشعارات وساعات عدم الإزعاج</h3>
            <p className="mt-1 text-[12px] text-ink-faint">
              تحديد القنوات المستلمة للإشعارات (بريد، سطح المكتب، داخل التطبيق) وتفعيل ساعات الهدوء (القسم 13).
            </p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h4 className="text-[13.5px] font-bold text-ink">قنوات التسليم:</h4>
              {[
                ["inAppEnabled", "إشعارات داخل التطبيق", prefs.inAppEnabled],
                ["emailEnabled", "ملخص إشعارات البريد الإلكتروني", prefs.emailEnabled],
                ["pushEnabled", "إشعارات المتصفح وسطح المكتب", prefs.pushEnabled],
              ].map(([key, label, val]) => (
                <div
                  key={String(key)}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised/50 p-3.5"
                >
                  <span className="text-[13px] font-semibold text-ink">{label}</span>
                  <Toggle
                    ariaLabel={String(label)}
                    checked={Boolean(val)}
                    disabled={pendingAction !== null}
                    onChange={(v) => void handlePrefChange({ [key as string]: v })}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-2xl border border-accent/25 bg-accent/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[14px] font-bold text-ink">ساعات عدم الإزعاج</h4>
                  <p className="text-[11.5px] text-ink-faint">كتم جميع التنبيهات والأصوات خلال هذه الفترة.</p>
                </div>
                <Toggle
                  ariaLabel="ساعات عدم الإزعاج"
                  checked={prefs.dndEnabled}
                  disabled={pendingAction !== null}
                  onChange={(v) => void handlePrefChange({ dndEnabled: v })}
                />
              </div>

              {prefs.dndEnabled && (
                <div className="grid gap-3 pt-3 animate-fade sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                      من الساعة:
                    </span>
                    <input
                      name="auto-field-tuywj4r"
                      type="time"
                      value={prefs.dndStart}
                      disabled={pendingAction !== null}
                      onChange={(e) => void handlePrefChange({ dndStart: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                      إلى الساعة:
                    </span>
                    <input
                      name="auto-field-8wwufbm"
                      type="time"
                      value={prefs.dndEnd}
                      disabled={pendingAction !== null}
                      onChange={(e) => void handlePrefChange({ dndEnd: e.target.value })}
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
        <Card className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <div>
              <h3 className="text-[16px] font-bold text-ink">إدارة فروع المؤسسة</h3>
              <p className="mt-1 text-[12px] text-ink-faint">
                تنظيم مساحات العمل والفرق وتوزيع الموظفين عبر فروع متعددة للمؤسسات الكبرى (مثل فرع الرياض، دبي،
                القاهرة).
              </p>
            </div>
            {ctx.can("branches.manage") && (
              <Btn
                variant="glow"
                disabled={pendingAction !== null}
                onClick={async () => {
                  const name = await promptAction({
                    title: ctx.t("إضافة فرع جديد", "Add a new branch"),
                    label: ctx.t("اسم الفرع", "Branch name"),
                    defaultValue: ctx.t("فرع جدة", "Jeddah branch"),
                    placeholder: ctx.t("مثال: المقر الإقليمي - جدة", "Example: Jeddah regional office"),
                    confirmLabel: ctx.t("التالي", "Next"),
                  });
                  if (!name) return;
                  const code = await promptAction({
                    title: ctx.t("رمز الفرع", "Branch code"),
                    message: ctx.t(
                      "استخدم رمزاً قصيراً وفريداً للتعرف على الفرع.",
                      "Use a short, unique code to identify the branch.",
                    ),
                    label: ctx.t("الرمز", "Code"),
                    defaultValue: "JED-REG",
                    placeholder: "JED-HQ",
                    confirmLabel: ctx.t("إضافة الفرع", "Add branch"),
                  });
                  if (!code) return;
                  await addBranch(name.trim(), code.trim(), "جدة");
                }}
              >
                + إضافة فرع جديد
              </Btn>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {branches.map((br) => (
              <div
                key={br.id}
                className="rounded-xl border border-line bg-raised/50 p-4 transition hover:border-accent/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-[15px] font-bold text-ink">{br.name}</span>
                  <Badge tone="cyan">{br.code}</Badge>
                </div>
                <div className="mt-2.5 text-[12px] text-ink-faint">
                  <div>
                    {ctx.t("المدينة", "City")}: <span className="font-semibold text-ink-soft">{br.city || "—"}</span>
                  </div>
                  {br.address && <div className="mt-1 truncate">{br.address}</div>}
                </div>
              </div>
            ))}
            {branches.length === 0 && (
              <p className="col-span-3 py-8 text-center text-[13px] text-slate-400 dark:text-zinc-500">
                {ctx.t("لا توجد فروع مضافة لهذه المؤسسة بعد.", "No branches have been added to this organization yet.")}
              </p>
            )}
          </div>
        </Card>
      )}

      {activeTab === "lifecycle" && <AccountLifecycleCard ctx={ctx} />}

      {/* TOTP setup modal */}
      {showQrModal && mfaSetup && (
        <Modal
          open
          onClose={closeMfaSetup}
          title={ctx.t("إعداد تطبيق المصادقة", "Set up an authenticator app")}
          icon={<IconShield size={17} />}
          closeLabel={ctx.t("إغلاق إعداد المصادقة الثنائية", "Close two-factor setup")}
          panelClassName="max-w-[440px]"
        >
          <div className="text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              {ctx.t(
                "أضف الحساب في تطبيق Google Authenticator أو Authy أو 1Password باستخدام المفتاح التالي، ثم أدخل الرمز الحالي المكون من 6 أرقام.",
                "Add the account to Google Authenticator, Authy, or 1Password with the key below, then enter the current six-digit code.",
              )}
            </p>

            <div className="my-5 rounded-2xl border border-indigo-400/40 bg-raised p-4">
              <div className="text-[11px] font-bold uppercase text-ink-soft">
                {ctx.t("المفتاح اليدوي", "Manual key")}
              </div>
              <div
                dir="ltr"
                className="mt-2 break-all font-mono text-sm font-bold tracking-wider text-indigo-600 dark:text-violet-300"
              >
                {mfaSetup.secret}
              </div>
              <a
                href={mfaSetup.uri}
                className="mt-3 inline-block text-xs font-semibold text-violet-600 hover:underline dark:text-violet-300"
              >
                {ctx.t("فتح رابط الإعداد في تطبيق المصادقة", "Open setup link in authenticator app")}
              </a>
            </div>

            <input
              name="auto-field-n6vgm3n"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="123456"
              aria-label={ctx.t("رمز المصادقة المكون من 6 أرقام", "Six-digit authentication code")}
              className="mx-auto block h-12 w-40 rounded-xl border border-line bg-surface text-center font-mono text-2xl font-bold tracking-widest text-ink outline-none focus:border-indigo-600 focus:ring-3 focus:ring-indigo-500/15"
            />

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
              <Btn
                variant="glow"
                size="lg"
                className="flex-1"
                disabled={totpCode.length !== 6 || pendingAction !== null}
                onClick={enable2FA}
              >
                {ctx.t("تأكيد وتفعيل المصادقة الثنائية", "Confirm and enable two-factor authentication")}
              </Btn>
              <Btn variant="outline" size="lg" className="sm:min-w-24" onClick={closeMfaSetup}>
                {ctx.t("إلغاء", "Cancel")}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
