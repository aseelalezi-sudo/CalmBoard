import type { SVGProps, ReactNode } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(children: ReactNode, displayName: string) {
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ---------- Brand ---------- */
export const LogoMark = ({ size = 26, ...rest }: IconProps) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" {...rest}>
    <image href="/icon.svg" width="32" height="32" />
  </svg>
);

/* ---------- Navigation & layout ---------- */
export const IconBoard = make(
  <>
    <rect x="3" y="4" width="5.4" height="16" rx="1.8" />
    <rect x="9.3" y="4" width="5.4" height="11" rx="1.8" />
    <rect x="15.6" y="4" width="5.4" height="7" rx="1.8" />
  </>,
  "IconBoard",
);
export const IconList = make(
  <>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <circle cx="4" cy="6" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="0.8" fill="currentColor" stroke="none" />
  </>,
  "IconList",
);
export const IconTable = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18" />
    <path d="M9.5 9.5V20" />
  </>,
  "IconTable",
);
export const IconCalendar = make(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
  </>,
  "IconCalendar",
);
export const IconTimeline = make(
  <>
    <path d="M3 6h8" />
    <path d="M7 12h11" />
    <path d="M10 18h8" />
    <circle cx="13" cy="6" r="1.6" />
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="8" cy="18" r="1.6" />
  </>,
  "IconTimeline",
);
export const IconGauge = make(
  <>
    <path d="M12 20a8 8 0 1 1 8-8" />
    <path d="M12 12l4.5-3" />
    <path d="M20 16.5v.01" />
  </>,
  "IconGauge",
);
export const IconDash = make(
  <>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="5" rx="2" />
    <rect x="13" y="10" width="8" height="11" rx="2" />
    <rect x="3" y="13" width="8" height="8" rx="2" />
  </>,
  "IconDash",
);
export const IconInbox = make(
  <>
    <path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13" />
    <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    <path d="M4 13h4.5l1.5 2.5h4L15.5 13H20" />
  </>,
  "IconInbox",
);
export const IconMyWork = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
  </>,
  "IconMyWork",
);

/* ---------- Entities ---------- */
export const IconDoc = make(
  <>
    <path
      d="M6 3h8l5 5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 21V4.5A1.5 1.5 0 0 1 6.5 3Z"
      transform="translate(-0.5 0)"
    />
    <path d="M14 3v5h5" />
    <path d="M8.5 13h7" />
    <path d="M8.5 17h5" />
  </>,
  "IconDoc",
);
export const IconTarget = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.4" />
  </>,
  "IconTarget",
);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>,
  "IconClock",
);
export const IconBolt = make(<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />, "IconBolt");
export const IconForm = make(
  <>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h4" />
  </>,
  "IconForm",
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
    <path d="M15.5 5.5a3.5 3.5 0 0 1 0 6" />
    <path d="M17.5 15.5c2 .7 3.5 2.2 4 4.5" />
  </>,
  "IconUsers",
);
export const IconFolder = make(
  <path d="M3 7a2 2 0 0 1 2-2h4l2.5 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  "IconFolder",
);
export const IconBriefcase = make(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
    <path d="M3 12.5c5.7 2 12.3 2 18 0" />
    <path d="M10 13.5h4" />
  </>,
  "IconBriefcase",
);
export const IconRocket = make(
  <>
    <path d="M12 15c5-3 6.5-7.5 6.5-11.5-4 0-8.5 1.5-11.5 6.5" />
    <path d="M7 10 3.5 11.5 6 14" />
    <path d="M14 17l-1.5 3.5L10 18" />
    <circle cx="13.5" cy="8.5" r="1.6" />
    <path d="M6 18c-1 1-1.5 2.5-1.5 4 1.5 0 3-.5 4-1.5" />
  </>,
  "IconRocket",
);
export const IconTrend = make(
  <>
    <path d="M3 17l6-6 4 4 7-8" />
    <path d="M14 7h6v6" />
  </>,
  "IconTrend",
);
export const IconFlag = make(
  <>
    <path d="M5 21V4" />
    <path d="M5 4c3-2 6 2 9 0v8c-3 2-6-2-9 0" />
  </>,
  "IconFlag",
);

/* ---------- Actions ---------- */
export const IconSearch = make(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.9-4.9" />
  </>,
  "IconSearch",
);
export const IconBell = make(
  <>
    <path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 15h15L18 12.5V9a6 6 0 0 0-6-6Z" />
    <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
  </>,
  "IconBell",
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, "IconPlus");
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />, "IconX");
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />, "IconMenu");
export const IconCheck = make(<path d="M4.5 12.5 9.5 17.5 19.5 7" />, "IconCheck");
export const IconChevron = make(<path d="m9 5 7 7-7 7" />, "IconChevron");
export const IconSparkle = make(
  <>
    <path d="M12 3.5 13.8 9 19.5 11 13.8 13 12 18.5 10.2 13 4.5 11 10.2 9 12 3.5Z" />
    <path d="M19 17.5v4M17 19.5h4" />
  </>,
  "IconSparkle",
);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
  "IconSun",
);
export const IconMoon = make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />, "IconMoon");
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </>,
  "IconGlobe",
);
export const IconFilter = make(<path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5Z" />, "IconFilter");
export const IconSave = make(
  <>
    <path d="M5 3h11l5 5v13H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" transform="translate(1 0) scale(0.92)" />
    <path d="M7 3v5h8V3" />
    <rect x="8" y="13" width="8" height="7" rx="1" />
  </>,
  "IconSave",
);
export const IconShare = make(
  <>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6" />
  </>,
  "IconShare",
);
export const IconTrash = make(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
    <path d="M6.5 7 7.5 20h9L17.5 7" />
    <path d="M10 11v5M14 11v5" />
  </>,
  "IconTrash",
);
export const IconMore = make(
  <>
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  </>,
  "IconMore",
);
export const IconSend = make(<path d="M20.5 3.5 3 10l7 3 3 7 7.5-16.5ZM10 13l4.5-4.5" />, "IconSend");
export const IconPlay = make(<path d="M7 4.5v15l12-7.5L7 4.5Z" />, "IconPlay");
export const IconStop = make(<rect x="6" y="6" width="12" height="12" rx="2" />, "IconStop");
export const IconPaperclip = make(
  <path d="m20 11-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17a2 2 0 0 1-3-3l7.5-7.5" />,
  "IconPaperclip",
);
export const IconAt = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
  </>,
  "IconAt",
);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5l1 2.6a7 7 0 0 1 2.4 1l2.6-1 1.5 2.6-2 1.8a7 7 0 0 1 0 2.8l2 1.8-1.5 2.6-2.6-1a7 7 0 0 1-2.4 1l-1 2.6-1-2.6a7 7 0 0 1-2.4-1l-2.6 1-1.5-2.6 2-1.8a7 7 0 0 1 0-2.8l-2-1.8L4.5 5l2.6 1a7 7 0 0 1 2.4-1l1-2.5Z" />
  </>,
  "IconSettings",
);
export const IconShield = make(
  <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4.5" />,
  "IconShield",
);
export const IconLink = make(
  <>
    <path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
    <path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />
  </>,
  "IconLink",
);
export const IconSubtask = make(
  <>
    <path d="M5 5v7a4 4 0 0 0 4 4h5" />
    <path d="m11 13 3 3-3 3" />
    <circle cx="5" cy="5" r="1.4" />
  </>,
  "IconSubtask",
);
export const IconComment = make(<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z" />, "IconComment");
export const IconCollapse = make(<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />, "IconCollapse");
export const IconMail = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </>,
  "IconMail",
);
export const IconTag = make(
  <>
    <path d="M3 11V4.5A1.5 1.5 0 0 1 4.5 3H11l9 9-8 8-9-9Z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </>,
  "IconTag",
);
export const IconArrowUp = make(<path d="M12 19V5m0 0-6 6m6-6 6 6" />, "IconArrowUp");
export const IconArrowDown = make(<path d="M12 5v14m0 0 6-6m-6 6-6-6" />, "IconArrowDown");
export const IconEye = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  "IconEye",
);
export const IconDatabase = make(
  <>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </>,
  "IconDatabase",
);
export const IconLayers = make(
  <>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m4 13.5 8 4.5 8-4.5" />
    <path d="m4 17.5 8 4.5 8-4.5" transform="scale(1) translate(0 -1)" />
  </>,
  "IconLayers",
);
export const IconIntegration = make(
  <>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    <circle cx="12" cy="12" r="3" />
  </>,
  "IconIntegration",
);
export const IconCode = make(
  <>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </>,
  "IconCode",
);
export const IconStamp = make(
  <>
    <path d="M14 13V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5" />
    <path d="M4 13h12a2 2 0 0 1 2 2v1H2v-1a2 2 0 0 1 2-2Z" />
    <path d="M2 18h16v2H2Z" />
  </>,
  "IconStamp",
);
