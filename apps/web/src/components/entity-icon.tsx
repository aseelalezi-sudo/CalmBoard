import {
  IconBoard,
  IconBolt,
  IconBriefcase,
  IconCalendar,
  IconClock,
  IconCode,
  IconDash,
  IconDatabase,
  IconDoc,
  IconFlag,
  IconFolder,
  IconForm,
  IconGauge,
  IconInbox,
  IconIntegration,
  IconLayers,
  IconList,
  IconRocket,
  IconSettings,
  IconShield,
  IconTable,
  IconTag,
  IconTarget,
  IconTimeline,
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
  "file-text": IconDoc,
  file: IconDoc,
  document: IconDoc,
  doc: IconDoc,
  "code-2": IconCode,
  code: IconCode,
  rocket: IconRocket,
  board: IconBoard,
  kanban: IconBoard,
  dashboard: IconDash,
  calendar: IconCalendar,
  target: IconTarget,
  clock: IconClock,
  bolt: IconBolt,
  zap: IconBolt,
  users: IconUsers,
  team: IconUsers,
  settings: IconSettings,
  shield: IconShield,
  database: IconDatabase,
  form: IconForm,
  inbox: IconInbox,
  tag: IconTag,
  flag: IconFlag,
  layers: IconLayers,
  integration: IconIntegration,
  list: IconList,
  table: IconTable,
  timeline: IconTimeline,
  gauge: IconGauge,
  trend: IconTrend,
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
