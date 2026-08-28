import {
  IconBell,
  IconBoard,
  IconBolt,
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconClock,
  IconCode,
  IconComment,
  IconDash,
  IconDatabase,
  IconDoc,
  IconEye,
  IconFilter,
  IconFlag,
  IconFolder,
  IconForm,
  IconGauge,
  IconGlobe,
  IconInbox,
  IconIntegration,
  IconLayers,
  IconLink,
  IconList,
  IconLock,
  IconMail,
  IconMap,
  IconMegaphone,
  IconMoon,
  IconPalette,
  IconPaperclip,
  IconRocket,
  IconSave,
  IconSearch,
  IconSettings,
  IconShare,
  IconShield,
  IconSmartphone,
  IconSparkle,
  IconStar,
  IconSun,
  IconTable,
  IconTag,
  IconTarget,
  IconTimeline,
  IconTrash,
  IconTrend,
  IconUsers,
} from "@/components/icons";
import { cn } from "@/lib/utils";

type EntityIconFallback = "project" | "workspace" | "document";
type IconComponent = typeof IconFolder;

const namedIcons: Record<string, IconComponent> = {
  folder: IconFolder,
  project: IconFolder,
  projects: IconFolder,
  briefcase: IconBriefcase,
  workspace: IconBriefcase,
  workspaces: IconBriefcase,
  "file-text": IconDoc,
  file: IconDoc,
  document: IconDoc,
  doc: IconDoc,
  docs: IconDoc,
  "code-2": IconCode,
  code: IconCode,
  rocket: IconRocket,
  board: IconBoard,
  kanban: IconBoard,
  dashboard: IconDash,
  dash: IconDash,
  calendar: IconCalendar,
  target: IconTarget,
  goal: IconTarget,
  goals: IconTarget,
  clock: IconClock,
  time: IconClock,
  timer: IconClock,
  bolt: IconBolt,
  zap: IconBolt,
  automation: IconBolt,
  automations: IconBolt,
  users: IconUsers,
  user: IconUsers,
  team: IconUsers,
  member: IconUsers,
  members: IconUsers,
  settings: IconSettings,
  shield: IconShield,
  security: IconShield,
  database: IconDatabase,
  form: IconForm,
  forms: IconForm,
  inbox: IconInbox,
  tag: IconTag,
  tags: IconTag,
  flag: IconFlag,
  layers: IconLayers,
  integration: IconIntegration,
  integrations: IconIntegration,
  list: IconList,
  table: IconTable,
  timeline: IconTimeline,
  gauge: IconGauge,
  workload: IconGauge,
  trend: IconTrend,
  "trending-up": IconTrend,
  trending_up: IconTrend,
  trendingup: IconTrend,
  chart: IconTrend,
  analytics: IconTrend,
  megaphone: IconMegaphone,
  marketing: IconMegaphone,
  announcement: IconMegaphone,
  smartphone: IconSmartphone,
  mobile: IconSmartphone,
  phone: IconSmartphone,
  app: IconSmartphone,
  palette: IconPalette,
  design: IconPalette,
  art: IconPalette,
  map: IconMap,
  roadmap: IconMap,
  sparkle: IconSparkle,
  sparkles: IconSparkle,
  ai: IconSparkle,
  star: IconStar,
  bell: IconBell,
  notification: IconBell,
  notifications: IconBell,
  lock: IconLock,
  eye: IconEye,
  link: IconLink,
  mail: IconMail,
  email: IconMail,
  check: IconCheck,
  search: IconSearch,
  sun: IconSun,
  moon: IconMoon,
  globe: IconGlobe,
  filter: IconFilter,
  trash: IconTrash,
  save: IconSave,
  share: IconShare,
  comment: IconComment,
  comments: IconComment,
  paperclip: IconPaperclip,
  attachment: IconPaperclip,
  attachments: IconPaperclip,
};

const fallbackIcons: Record<EntityIconFallback, IconComponent> = {
  project: IconFolder,
  workspace: IconBriefcase,
  document: IconDoc,
};

function normalizedIconName(value: string) {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function isEmojiValue(value: string) {
  const codePoints = Array.from(value);
  return (
    codePoints.length > 0 &&
    codePoints.length <= 8 &&
    !/[\p{L}\p{N}\s]/u.test(value) &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value)
  );
}

export function resolveEntityIcon(value: string | null | undefined, fallback: EntityIconFallback) {
  const trimmed = value?.trim() ?? "";
  const named = namedIcons[normalizedIconName(trimmed)];
  if (named) return { type: "named" as const, Icon: named };
  if (isEmojiValue(trimmed)) return { type: "emoji" as const, value: trimmed };
  return { type: "fallback" as const, Icon: fallbackIcons[fallback] };
}

export function EntityIcon({
  value,
  fallback,
  size = 16,
  className,
}: {
  value?: string | null;
  fallback: EntityIconFallback;
  size?: number;
  className?: string;
}) {
  const resolved = resolveEntityIcon(value, fallback);
  if (resolved.type === "emoji") {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-grid place-items-center leading-none", className)}
        style={{ fontSize: size }}
      >
        {resolved.value}
      </span>
    );
  }
  return <resolved.Icon size={size} className={className} />;
}
