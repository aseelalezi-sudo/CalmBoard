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
  IconFolder,
  IconRocket,
} from "@/components/icons";

export const NAV_WORK = [
  { id: "mywork", ar: "عملي", en: "My Work", Icon: IconMyWork },
  { id: "projects", ar: "المشاريع", en: "Projects", Icon: IconFolder },
  { id: "inbox", ar: "الوارد", en: "Inbox", Icon: IconInbox },
  { id: "dashboard", ar: "لوحة التحكم", en: "Dashboard", Icon: IconDash },
];

export const NAV_SPACE = [
  { id: "docs", ar: "المستندات", en: "Docs", Icon: IconDoc },
  { id: "goals", ar: "الأهداف", en: "Goals", Icon: IconTarget },
  { id: "time", ar: "تتبع الوقت", en: "Time Tracking", Icon: IconClock },
];

export const NAV_TOOLS = [
  { id: "automation", ar: "الأتمتة", en: "Automations", Icon: IconBolt },
  { id: "forms", ar: "النماذج", en: "Forms", Icon: IconForm },
  { id: "integrations", ar: "التكاملات", en: "Integrations", Icon: IconIntegration },
];

export const NAV_ADMIN = [
  { id: "workspaces", ar: "مساحات العمل", en: "Workspaces", Icon: IconFolder },
  { id: "settings", ar: "إعدادات مساحة العمل", en: "Workspace Settings", Icon: IconSettings },
  { id: "members", ar: "الأعضاء", en: "Members", Icon: IconUsers },
  { id: "billing", ar: "الفوترة", en: "Billing", Icon: IconShield },
  { id: "activity", ar: "سجل التدقيق", en: "Audit Log", Icon: IconDatabase },
];

export const VIEW_TABS = [
  { id: "table", ar: "جدول", en: "Table", Icon: IconTable },
  { id: "board", ar: "لوحة", en: "Board", Icon: IconBoard },
  { id: "list", ar: "قائمة", en: "List", Icon: IconList },
  { id: "calendar", ar: "تقويم", en: "Calendar", Icon: IconCalendar },
  { id: "timeline", ar: "زمني", en: "Timeline", Icon: IconTimeline },
  { id: "workload", ar: "عبء العمل", en: "Workload", Icon: IconGauge },
  { id: "sprints", ar: "السبرنتات", en: "Sprints", Icon: IconRocket },
];
