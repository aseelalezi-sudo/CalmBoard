"use client";
import { Modal, Btn, Badge } from "./ui";
import { IconSparkle, IconTable, IconDoc, IconShield, IconCode, IconCheck } from "./icons";
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
      title_ar: "التنقل السريع بين طرق العرض",
      title_en: "Seamless Views Switching",
      desc_ar:
        "اعرض بيانات المهام بعدة طرق مترابطة: القائمة والجدول المتقدم ولوحة كانبان والتقويم ومخطط جانت وعبء العمل.",
      desc_en:
        "Use connected task views: list, advanced table, Kanban board, calendar, Gantt chart, and team workload.",
      icon: <IconTable size={18} />,
      badge_ar: "طرق عرض المهام",
      badge_en: "Task views",
    },
    {
      step: "2",
      title_ar: "المساعد الذكي وقوالب البداية",
      title_en: "Executive AI Assistant & Starter Kits",
      desc_ar:
        "عند إنشاء مشروع جديد، يمكنك اختيار قالب ذكي مثل سكرم المرن أو حملة تسويقية أو خارطة طريق. كما يتيح لك زر المساعد الذكي تقسيم المهام الكبيرة وتلخيص المشاريع وتوليد تقارير تنفيذية للقيادة بضغطة زر.",
      desc_en:
        "When creating a project, pick a Starter Kit (Scrum, Marketing, Roadmap). Use the AI Assistant to break down tasks, summarize projects, and generate executive leadership briefs.",
      icon: <IconSparkle size={18} />,
      badge_ar: "التخطيط والمساعد",
      badge_en: "Planning and AI",
    },
    {
      step: "3",
      title_ar: "قاعدة المعرفة ومحرر المستندات بالكتل",
      title_en: "Notion-Style Block Editor & Wiki",
      desc_ar:
        "محرر وثائق قوي يدعم نظام الكتل، وقوائم الأوامر السريعة عبر حرف الشرطة المائلة، وحفظ اللقطات وتاريخ الإصدارات، والتحويل اللحظي لأي فقرة أو قرار في المستند إلى مهمة تنفيذية.",
      desc_en:
        "Powerful block editor supporting slash commands (/), version history snapshots with point-in-time restore, and one-click turn-into-task for meeting notes and PRDs.",
      icon: <IconDoc size={18} />,
      badge_ar: "المستندات",
      badge_en: "Documents",
    },
    {
      step: "4",
      title_ar: "الأمان والمصادقة الثنائية والتكاملات الخارجية",
      title_en: "Enterprise Security, 2FA & Webhook Integrations",
      desc_ar: webAuthnUiEnabled
        ? "من تبويب حسابي والأمان، يمكنك إدارة الجلسات والأجهزة وتفعيل المصادقة الثنائية وحفظ رموز الاسترداد. تظهر معاينة مفاتيح المرور فقط عند تفعيل الميزة."
        : "من تبويب حسابي والأمان، يمكنك إدارة الجلسات والأجهزة وتفعيل المصادقة الثنائية وحفظ رموز الاسترداد.",
      desc_en: webAuthnUiEnabled
        ? "Manage sessions, devices, TOTP, and recovery codes. The Passkeys preview is visible only because the WebAuthn flag is enabled."
        : "Manage active sessions, devices, TOTP, and recovery codes under Account & Security.",
      icon: <IconShield size={18} />,
      badge_ar: "الأمان",
      badge_en: "Security",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("دليل البدء السريع", "Quick start guide")}
      icon={<IconSparkle size={18} />}
      size="wide"
      closeLabel={t("إغلاق", "Close")}
      contentClassName="space-y-4"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-accent/20 bg-accent/6 p-4">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {t(
              "مرحباً بك في CalmBoard. ابدأ باختيار مساحة العمل والمشروع، ثم استخدم طرق العرض والمستندات والأهداف والأدوات المتاحة وفق صلاحياتك.",
              "Welcome to CalmBoard. Start by choosing a workspace and project, then use the views, documents, goals, and tools available to your role.",
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="indigo">{t("عزل بين المؤسسات", "Tenant isolation")}</Badge>
            <Badge tone="cyan">{t("واجهة API موثقة", "Documented API")}</Badge>
            <Badge tone="emerald">{t("تجربة عربية وإنجليزية", "Arabic and English")}</Badge>
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((s) => (
            <div
              key={s.step}
              className="flex gap-3.5 rounded-xl border border-line bg-raised p-4 transition hover:border-accent/30"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 font-bold text-accent">
                {s.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[14px] font-bold text-ink">{t(s.title_ar, s.title_en)}</h4>
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                    {t(s.badge_ar, s.badge_en)}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{t(s.desc_ar, s.desc_en)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <a
              href="/api-reference"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition hover:border-accent/30 hover:bg-raised hover:text-ink focus-ring"
            >
              <IconCode size={14} />
              <span>{t("وثائق الـ API", "API Reference")}</span>
            </a>
          </div>
          <Btn variant="primary" onClick={onClose} className="w-full px-5 sm:w-auto">
            <IconCheck size={14} />
            <span>{t("فهمت، لنبدأ العمل!", "Got it, let's explore!")}</span>
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
