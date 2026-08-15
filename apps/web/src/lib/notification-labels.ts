import type { Notification, ViewCtx } from "./types";

type Translate = ViewCtx["t"];

const knownArabic: Record<string, string> = {
  "Launch Plan": "خطة الإطلاق",
  "Mobile bottom navigation": "التنقل السفلي في الهاتف",
  "Build dashboard builder with widgets": "إنشاء لوحة معلومات قابلة للتخصيص",
  "Invitation accepted": "تم قبول دعوتك",
  "You are now a workspace member": "أصبحت عضواً في مساحة العمل",
  "You were mentioned": "تمت الإشارة إليك",
  "New reply to your comment": "رد جديد على تعليقك",
};

function arabicNotificationText(value: string) {
  const bilingualArabic = value.split("|")[0]?.trim();
  if (bilingualArabic && /[\u0600-\u06ff]/u.test(bilingualArabic)) return bilingualArabic;
  if (knownArabic[value]) return knownArabic[value];
  const automationTitle = value.match(/^Automation:\s*(.+)$/i);
  if (automationTitle) return `أتمتة: ${automationTitle[1]}`;
  const automationBody = value.match(/^Automation rule executed for task\s+(.+)$/i);
  if (automationBody) return `نُفذت قاعدة الأتمتة للمهمة ${automationBody[1]}`;
  return value;
}

export function notificationTitle(notification: Notification, t: Translate) {
  return t(arabicNotificationText(notification.title), notification.title);
}

export function notificationBody(notification: Notification, t: Translate) {
  if (!notification.body) return "";
  return t(arabicNotificationText(notification.body), notification.body);
}
