"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Btn, Card, ScreenHeader, ScreenState, SegmentedTabs } from "@/components/ui";
import { IconCheck, IconMail } from "@/components/icons";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-u-nu-latn" : "en-US");

export function InboxView({ ctx }: { ctx: ViewCtx }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);

  const unreadNotifications = ctx.notifications.filter((n) => !n.isRead);
  const unreadCount = unreadNotifications.length;
  const visibleNotifications = filter === "unread" ? unreadNotifications : ctx.notifications;

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("صندوق الوارد", "Inbox")}
        description={ctx.t(
          "تتبع الإشعارات، التكليفات، والتحديثات المباشرة لفريقك.",
          "Track notifications, assignments, and live team updates.",
        )}
        actions={
          unreadCount > 0 ? (
            <Btn
              variant="outline"
              size="sm"
              disabled={markingAll}
              aria-busy={markingAll}
              onClick={async () => {
                setMarkingAll(true);
                try {
                  await ctx.markAllNotificationsRead();
                } finally {
                  setMarkingAll(false);
                }
              }}
            >
              <IconCheck size={14} />
              {ctx.t("تعليم الكل كمقروء", "Mark all as read")}
            </Btn>
          ) : undefined
        }
      />

      <SegmentedTabs
        value={filter}
        onChange={(val) => setFilter(val as "all" | "unread")}
        items={[
          {
            id: "all",
            label: `${ctx.t("الكل", "All")} (${fmtNumber(ctx.notifications.length, ctx.locale)})`,
          },
          {
            id: "unread",
            label: `${ctx.t("غير المقروءة", "Unread")} (${fmtNumber(unreadCount, ctx.locale)})`,
          },
        ]}
      />

      <div role="feed" aria-label={ctx.t("قائمة الإشعارات", "Notifications feed")} className="space-y-3">
        {visibleNotifications.map((n, index) => (
          <article
            key={n.id}
            role="article"
            aria-posinset={index + 1}
            aria-setsize={visibleNotifications.length}
            className={`rounded-2xl border transition ${
              !n.isRead ? "border-accent/30 bg-accent/5 shadow-sm" : "border-line bg-surface hover:bg-raised/50"
            }`}
          >
            <button
              type="button"
              onClick={() => ctx.openNotification(n)}
              className="flex w-full items-start gap-3.5 p-4 text-start outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-2xl"
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
                  !n.isRead ? "border-accent/30 bg-accent/15 text-accent" : "border-line bg-raised text-ink-soft"
                }`}
              >
                <IconMail size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[13.5px] ${!n.isRead ? "font-bold text-ink" : "font-semibold text-ink-soft"}`}>
                    {n.title}
                  </span>
                  {!n.isRead && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                </div>
                {n.body && <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{n.body}</p>}
                <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-faint">
                  <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString(dateLocale(ctx.locale))}</time>
                </div>
              </div>
            </button>
          </article>
        ))}
      </div>

      {visibleNotifications.length === 0 && (
        <Card className="bg-surface">
          <ScreenState
            framed={false}
            tone="empty"
            title={
              filter === "unread"
                ? ctx.t("لا توجد إشعارات غير مقروءة", "No unread notifications")
                : ctx.t("صندوق الوارد فارغ", "Inbox is empty")
            }
            description={
              filter === "unread"
                ? ctx.t("أنت مطلع على جميع التحديثات والتنبيهات.", "You're all caught up with everything!")
                : ctx.t(
                    "ستظهر التنبيهات والإشعارات الجديدة هنا فور وصولها.",
                    "New alerts and assignments will appear here.",
                  )
            }
          />
        </Card>
      )}
    </div>
  );
}
