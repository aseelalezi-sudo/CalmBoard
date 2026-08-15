"use client";
import { Badge, Btn, Kbd, Modal } from "./ui";
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
  if (!open) return null;

  const categories = [
    {
      title_ar: "الفتح والتنقل العام",
      title_en: "Global Navigation",
      items: [
        {
          kbd: ["Ctrl/⌘", "K"],
          desc_ar: "فتح لوحة الأوامر والبحث العام",
          desc_en: "Open Command Palette & Global Search",
        },
        { kbd: ["Ctrl/⌘", "N"], desc_ar: "إنشاء مهمة جديدة فوراً", desc_en: "Quick Create New Task" },
        {
          kbd: ["ESC"],
          desc_ar: "إغلاق النافذة الحالية أو إلغاء التحديد",
          desc_en: "Close active modal or drawer",
        },
        { kbd: ["?"], desc_ar: "فتح دليل اختصارات لوحة المفاتيح", desc_en: "Open Keyboard Shortcuts Help" },
      ],
    },
    {
      title_ar: "محرر المستندات والكتل",
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
          desc_ar: "سطر جديد داخل نفس الكتلة",
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
      title_ar: "إدارة المهام والتعليقات",
      title_en: "Tasks & Collaboration",
      items: [
        {
          kbd: ["Ctrl/⌘", "↵"],
          desc_ar: "إرسال التعليق فوراً داخل لوحة المهمة",
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
      title_ar: "جدول البيانات المتقدم",
      title_en: "Advanced Data Grid",
      items: [
        {
          kbd: ["Click"],
          desc_ar: "فتح تفاصيل المهمة في النافذة الجانبية",
          desc_en: "Open Task Detail Drawer",
        },
        {
          kbd: ["Shift", "Click"],
          desc_ar: "تحديد مهام متتالية للتنفيذ الجماعي",
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
          kbd: ["Ctrl/⌘", "A"],
          desc_ar: "تحديد جميع صفوف الشبكة الحالية",
          desc_en: "Select all current grid rows",
        },
        {
          kbd: ["Ctrl/⌘", "C"],
          desc_ar: "نسخ المهام المحددة بصيغة جدول آمنة",
          desc_en: "Copy selected tasks as safe tabular data",
        },
        {
          kbd: ["Ctrl/⌘", "V"],
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
      title={t("دليل اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
      icon={<IconCode size={18} />}
      size="wide"
      closeLabel={t("إغلاق", "Close")}
      contentClassName="space-y-6"
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-accent/20 bg-accent/6 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-[14px] font-bold text-ink">
                {t(
                  "صُممت المنصة للعمل بسرعة البرق عبر لوحة المفاتيح",
                  "Designed for lightning-fast keyboard-first workflow",
                )}
              </h4>
              <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                {t(
                  "استخدم هذه الاختصارات للتنقل بين طرق العرض والمستندات والمهام دون مغادرة لوحة المفاتيح.",
                  "Use these shortcuts to move between views, documents, and tasks without leaving the keyboard.",
                )}
              </p>
            </div>
            <Badge tone="indigo" className="px-2.5 py-1 text-[11px] font-bold">
              {t("متوافق مع Windows وmacOS", "Windows and macOS")}
            </Badge>
          </div>
        </div>

        <div className="space-y-5">
          {categories.map((cat, idx) => (
            <div key={idx} className="space-y-2.5">
              <h5 className="border-b border-line pb-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-faint">
                {t(cat.title_ar, cat.title_en)}
              </h5>
              <div className="grid gap-2 sm:grid-cols-2">
                {cat.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-raised p-3 transition hover:border-accent/35"
                  >
                    <span className="flex-1 text-[12.5px] font-medium leading-snug text-ink-soft">
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

        <div className="flex flex-col gap-3 border-t border-line pt-4 text-[11.5px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t(
              "تلميح: اضغط ESC في أي وقت لإغلاق النوافذ المنبثقة",
              "Tip: Press ESC anytime to dismiss modals and popovers",
            )}
          </span>
          <Btn variant="primary" onClick={onClose} className="w-full sm:w-auto">
            {t("حسناً، فهمت", "Got it")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
