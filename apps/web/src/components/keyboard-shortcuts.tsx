"use client";
import React, { useEffect } from "react";
import { Modal, Kbd, Badge } from "./ui";
import { IconCode } from "./icons";

export function KeyboardShortcutsModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  // Listen for '?' key to open shortcuts modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        if (!open) {
          // You can dispatch a custom event or trigger open if passed via parent
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  const categories = [
    {
      title_ar: "الفتح والتنقل العام (Global Navigation)",
      title_en: "Global Navigation",
      items: [
        {
          kbd: ["⌘", "K"],
          desc_ar: "فتح لوحة الأوامر والبحث العام (Command Palette)",
          desc_en: "Open Command Palette & Global Search",
        },
        { kbd: ["⌘", "N"], desc_ar: "إنشاء مهمة جديدة فوراً (Quick Create Task)", desc_en: "Quick Create New Task" },
        {
          kbd: ["ESC"],
          desc_ar: "إغلاق النافذة الحالية أو إلغاء التحديد (Close / Cancel)",
          desc_en: "Close active modal or drawer",
        },
        { kbd: ["?"], desc_ar: "فتح دليل اختصارات لوحة المفاتيح (This Help)", desc_en: "Open Keyboard Shortcuts Help" },
      ],
    },
    {
      title_ar: "محرر المستندات والكتل (Notion-Style Editor)",
      title_en: "Notion-Style Block Editor",
      items: [
        {
          kbd: ["/"],
          desc_ar: "فتح قائمة أوامر TipTap السريعة (العناوين، القوائم، الجدول، الكود والتنبيه)",
          desc_en: "Open TipTap slash commands (headings, lists, table, code, and callout)",
        },
        {
          kbd: ["↵"],
          desc_ar: "إدراج فقرة جديدة أو تأكيد اختيار الكتلة",
          desc_en: "Insert new paragraph or confirm slash command",
        },
        {
          kbd: ["Shift", "↵"],
          desc_ar: "سطر جديد داخل نفس الكتلة (Line break)",
          desc_en: "New line within same block",
        },
        {
          kbd: ["Backspace"],
          desc_ar: "حذف الكتلة الفارغة الحالية والعودة للفقرة السابقة",
          desc_en: "Delete empty block & focus previous",
        },
      ],
    },
    {
      title_ar: "إدارة المهام والتعليقات (Tasks & Comments)",
      title_en: "Tasks & Collaboration",
      items: [
        {
          kbd: ["⌘", "↵"],
          desc_ar: "إرسال التعليق فوراً داخل لوحة المهمة (Send Comment)",
          desc_en: "Send comment inside Task Drawer",
        },
        {
          kbd: ["@"],
          desc_ar: "الإشارة إلى عضو في الفريق داخل التعليق (@Mention)",
          desc_en: "Mention a team member in comment",
        },
        {
          kbd: ["Tab"],
          desc_ar: "التنقل السلس بين الحقول في نماذج الإنشاء والتعديل",
          desc_en: "Navigate smoothly between form fields",
        },
      ],
    },
    {
      title_ar: "جدول البيانات المتقدم (TanStack Data Grid)",
      title_en: "Advanced Data Grid",
      items: [
        {
          kbd: ["Click"],
          desc_ar: "فتح تفاصيل المهمة في النافذة الجانبية (Open Task Drawer)",
          desc_en: "Open Task Detail Drawer",
        },
        {
          kbd: ["Shift", "Click"],
          desc_ar: "تحديد مهام متتالية للتنفيذ الجماعي (Bulk Select)",
          desc_en: "Range select tasks for bulk actions",
        },
        {
          kbd: ["Space"],
          desc_ar: "تحديد / إلغاء تحديد الصف الحالي في الجدول",
          desc_en: "Select / deselect current grid row",
        },
        {
          kbd: ["↑", "↓"],
          desc_ar: "التنقل بين صفوف شبكة المهام",
          desc_en: "Move between task grid rows",
        },
        {
          kbd: ["⌘", "A"],
          desc_ar: "تحديد جميع صفوف الشبكة الحالية",
          desc_en: "Select all current grid rows",
        },
        {
          kbd: ["⌘", "C"],
          desc_ar: "نسخ المهام المحددة بصيغة جدول آمنة",
          desc_en: "Copy selected tasks as safe tabular data",
        },
        {
          kbd: ["⌘", "V"],
          desc_ar: "لصق الحقول المسموحة على الصفوف المحددة",
          desc_en: "Paste allow-listed fields into selected rows",
        },
      ],
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(
        "⌨️ دليل اختصارات لوحة المفاتيح والإنتاجية (Keyboard Shortcuts)",
        "⌨️ Keyboard Shortcuts & Productivity Hub",
      )}
      icon={<IconCode size={18} />}
      wide
    >
      <div className="space-y-6 max-h-[72vh] overflow-y-auto pr-1">
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 to-violet-50/60 p-4 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:to-violet-500/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[14px] font-bold text-slate-900 dark:text-white">
                {t(
                  "صُممت المنصة للعمل بسرعة البرق عبر لوحة المفاتيح",
                  "Designed for lightning-fast keyboard-first workflow",
                )}
              </h4>
              <p className="mt-1 text-[12px] text-slate-600 dark:text-zinc-300">
                {t(
                  "القسم 20 & 24: استخدم هذه الاختصارات لتوفير الوقت والتنقل السريع بين طرق العرض والمستندات والمهام دون الحاجة لاستخدام الفأرة بكثرة.",
                  "Section 20 & 24: Master these shortcuts to save time and navigate seamlessly across views, docs, and tasks.",
                )}
              </p>
            </div>
            <Badge tone="indigo" className="px-2.5 py-1 text-[11px] font-bold">
              KEYBOARD FIRST
            </Badge>
          </div>
        </div>

        <div className="space-y-5">
          {categories.map((cat, idx) => (
            <div key={idx} className="space-y-2.5">
              <h5 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 border-b border-slate-100 pb-1.5 dark:border-white/10">
                {t(cat.title_ar, cat.title_en)}
              </h5>
              <div className="grid gap-2 sm:grid-cols-2">
                {cat.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 transition hover:border-indigo-500/40 hover:bg-white dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.05]"
                  >
                    <span className="text-[12.5px] font-medium text-slate-700 dark:text-zinc-300 leading-snug flex-1">
                      {t(item.desc_ar, item.desc_en)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.kbd.map((k, kIdx) => (
                        <Kbd key={kIdx}>{k}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-white/10 text-[11.5px] text-slate-500 dark:text-zinc-500">
          <span>
            💡{" "}
            {t(
              "تلميح: اضغط ESC في أي وقت لإغلاق النوافذ المنبثقة",
              "Tip: Press ESC anytime to dismiss modals and popovers",
            )}
          </span>
          <button
            onClick={onClose}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-[12px] font-bold text-white shadow-sm transition hover:brightness-110"
          >
            {t("حسناً، فهمت ✓", "Got it!")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
