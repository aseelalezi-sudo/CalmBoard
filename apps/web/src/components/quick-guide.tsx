"use client";
import React from "react";
import { Modal, Btn, Badge } from "./ui";
import { IconSparkle, IconBoard, IconTable, IconDoc, IconShield, IconCode, IconCheck } from "./icons";
import { webAuthnUiEnabled } from "@/lib/feature-flags";

export function QuickGuideModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  if (!open) return null;

  const steps = [
    {
      step: "1",
      title_ar: "التنقل السريع بين طرق العرض (Views)",
      title_en: "Seamless Views Switching",
      desc_ar:
        "تحتوي المنصة على 8 طرق عرض متقدمة لنفس البيانات دون تكرار: جدول البيانات (TanStack Grid) مع تصدير CSV/Excel، لوحة الكانبان التفاعلية مع السحب والإفلات، التقويم، المخطط الزمني (Timeline/Gantt)، وعبء العمل (Workload).",
      desc_en:
        "Switch instantly between 8 advanced views: TanStack Data Grid with CSV/Excel export, interactive Kanban Board with Drag & Drop, Calendar, Timeline/Gantt, and Team Workload.",
      icon: <IconTable size={18} />,
      badge: "القسم 10 & 19",
    },
    {
      step: "2",
      title_ar: "المساعد الذكي (AI Provider Adapter) وقوالب البداية",
      title_en: "Executive AI Assistant & Starter Kits",
      desc_ar:
        "عند إنشاء مشروع جديد، يمكنك اختيار قالب ذكي (Agile Scrum، حملة تسويقية، خارطة طريق). كما يتيح لك زر المساعد (✨ AI) تقسيم المهام الكبيرة، تلخيص المشاريع، وتوليد تقارير تنفيذية للقيادة بضغطة زر.",
      desc_en:
        "When creating a project, pick a Starter Kit (Scrum, Marketing, Roadmap). Use the AI Assistant to break down tasks, summarize projects, and generate executive leadership briefs.",
      icon: <IconSparkle size={18} />,
      badge: "القسم 21 & 32",
    },
    {
      step: "3",
      title_ar: "قاعدة المعرفة والمستندات (Notion-Style Block Editor)",
      title_en: "Notion-Style Block Editor & Wiki",
      desc_ar:
        "محرر وثائق قوي يدعم نظام الكتل، قوائم الأوامر السريعة عبر حرف السلاش (/)، حفظ اللقطات وتاريخ الإصدارات (Version History)، والتحويل اللحظي لأي فقرة أو قرار في المستند إلى مهمة تنفيذية.",
      desc_en:
        "Powerful block editor supporting slash commands (/), version history snapshots with point-in-time restore, and one-click turn-into-task for meeting notes and PRDs.",
      icon: <IconDoc size={18} />,
      badge: "القسم 16",
    },
    {
      step: "4",
      title_ar: "الأمان، 2FA، والتكاملات الخارجية (Integrations & RBAC)",
      title_en: "Enterprise Security, 2FA & Webhook Integrations",
      desc_ar: webAuthnUiEnabled
        ? "من تبويب (حسابي والأمان)، يمكنك إدارة الجلسات والأجهزة وتفعيل TOTP وحفظ رموز الاسترداد. تظهر معاينة Passkeys فقط لأن علم WebAuthn مفعّل."
        : "من تبويب (حسابي والأمان)، يمكنك إدارة الجلسات والأجهزة وتفعيل المصادقة الثنائية TOTP وحفظ رموز الاسترداد.",
      desc_en: webAuthnUiEnabled
        ? "Manage sessions, devices, TOTP, and recovery codes. The Passkeys preview is visible only because the WebAuthn flag is enabled."
        : "Manage active sessions, devices, TOTP, and recovery codes under Account & Security.",
      icon: <IconShield size={18} />,
      badge: "القسم 6 & 28",
    },
    {
      step: "5",
      title_ar: "لوحة السوبر أدمن وفحص العزل (Super Admin & Security Suite)",
      title_en: "Super Admin Panel & Tenancy Suite",
      desc_ar:
        "قم بزيارة المسار (/admin) للوصول إلى لوحة المدير العام، حيث يمكنك مراجعة مؤشرات قاعدة البيانات، مراقبة طوابير المهام، وتشغيل حزمة فحص الأمان وعزل المستأجرين الفورية.",
      desc_en:
        "Visit /admin to review database metrics, monitor background queues, and execute the real-time automated security and tenant isolation test suite.",
      icon: <IconBoard size={18} />,
      badge: "القسم 23 & 29",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("🚀 دليل البدء السريع في CalmBoard", "🚀 CalmBoard Quick Start Guide")}
      icon={<IconSparkle size={18} />}
      wide
    >
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 to-violet-50/50 p-4 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:to-violet-500/5">
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-zinc-200">
            مرحباً بك في <span className="font-bold">CalmBoard 2.0</span> — منصة إدارة العمل والمشاريع العصرية المصممة
            وفق معايير Enterprise SaaS العالمية. تعتمد الوحدات الظاهرة على بيانات وخدمات حقيقية، وتبقى المعاينات غير
            المكتملة مخفية افتراضياً خلف Feature Flags صريحة.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="indigo">Multi-Tenant Isolated</Badge>
            <Badge tone="cyan">OpenAPI 3.0 Documented</Badge>
            <Badge tone="emerald">PWA Standalone Ready</Badge>
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((s) => (
            <div
              key={s.step}
              className="flex gap-3.5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-indigo-500/30 dark:border-white/10 dark:bg-white/[0.02]"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 font-bold dark:bg-violet-500/10 dark:text-violet-300 border border-indigo-500/20">
                {s.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[14px] font-bold text-slate-900 dark:text-white">{t(s.title_ar, s.title_en)}</h4>
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700 dark:bg-white/10 dark:text-zinc-300">
                    {s.badge}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600 dark:text-zinc-400">
                  {t(s.desc_ar, s.desc_en)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <a
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-bold text-white transition hover:brightness-110"
            >
              <span>⚙️ {t("لوحة السوبر أدمن", "Super Admin")}</span>
            </a>
            <a
              href="/api-reference"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[12px] font-bold text-slate-700 transition hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              <IconCode size={14} />
              <span>{t("وثائق الـ API", "API Reference")}</span>
            </a>
          </div>
          <Btn variant="glow" onClick={onClose} className="px-5">
            <IconCheck size={14} />
            <span>{t("فهمت، لنبدأ العمل!", "Got it, let's explore!")}</span>
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
