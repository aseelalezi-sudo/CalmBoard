import {
  IconBoard,
  IconList,
  IconTable,
  IconCalendar,
  IconTimeline,
  IconGauge,
  IconDash,
  IconInbox,
  IconMyWork,
  IconDoc,
  IconTarget,
  IconClock,
  IconBolt,
  IconForm,
  IconUsers,
  IconIntegration,
  IconSettings,
  IconShield,
  IconDatabase,
} from "@/components/icons";

export const NAV_WORK = [
  { id: "mywork", ar: "عملي", en: "My Work", Icon: IconMyWork },
  { id: "dashboard", ar: "لوحة التحكم", en: "Dashboard", Icon: IconDash },
  { id: "inbox", ar: "الوارد", en: "Inbox", Icon: IconInbox },
];

export const NAV_SPACE = [
  { id: "docs", ar: "المستندات", en: "Docs", Icon: IconDoc },
  { id: "goals", ar: "الأهداف", en: "Goals", Icon: IconTarget },
  { id: "time", ar: "تتبع الوقت", en: "Time", Icon: IconClock },
  { id: "automation", ar: "الأتمتة", en: "Automations", Icon: IconBolt },
  { id: "forms", ar: "النماذج", en: "Forms", Icon: IconForm },
  { id: "members", ar: "الأعضاء", en: "Members", Icon: IconUsers },
  { id: "integrations", ar: "التكاملات", en: "Integrations", Icon: IconIntegration },
  { id: "billing", ar: "الفوترة", en: "Billing", Icon: IconShield },
  { id: "activity", ar: "سجل التدقيق", en: "Audit Log", Icon: IconDatabase },
  { id: "settings", ar: "إعدادات المساحة", en: "Workspace Settings", Icon: IconSettings },
  { id: "profile", ar: "حسابي والأمان", en: "Account & Security", Icon: IconShield },
];

export const VIEW_TABS = [
  { id: "table", ar: "جدول", en: "Table", Icon: IconTable },
  { id: "board", ar: "لوحة", en: "Board", Icon: IconBoard },
  { id: "list", ar: "قائمة", en: "List", Icon: IconList },
  { id: "calendar", ar: "تقويم", en: "Calendar", Icon: IconCalendar },
  { id: "timeline", ar: "زمني", en: "Timeline", Icon: IconTimeline },
  { id: "workload", ar: "العبء", en: "Workload", Icon: IconGauge },
];
