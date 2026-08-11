"use client";
import type { ViewCtx } from "@/lib/types";
import { Card, Empty } from "@/components/ui";
import { IconMail } from "@/components/icons";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-EG" : "en-US");

/* ================= Inbox View ================= */
export function InboxView({ ctx }: { ctx: ViewCtx }) {
  return (
    <div className="max-w-[680px] mx-auto">
      <h2 className="mb-5 text-[19px] font-bold text-slate-900 dark:text-white">{ctx.t("صندوق الوارد", "Inbox")}</h2>
      <div className="stagger space-y-2.5">
        {ctx.notifications.map((n) => (
          <Card
            key={n.id}
            className={`p-0 bg-white dark:bg-white/[0.025] ${!n.isRead ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-500/30 dark:bg-indigo-500/[0.05]" : ""}`}
          >
            <button
              type="button"
              onClick={() => ctx.openNotification(n)}
              className="flex w-full gap-3.5 rounded-[inherit] p-4 text-start transition hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/[0.04]"
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${!n.isRead ? "border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-500"}`}
              >
                <IconMail size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-zinc-100">{n.title}</span>
                  {!n.isRead && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-sm dark:bg-cyan-400 dark:shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                  )}
                </div>
                {n.body && (
                  <div className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-zinc-500">{n.body}</div>
                )}
                <div className="mt-1 text-[10.5px] text-slate-400 dark:text-zinc-600">
                  {new Date(n.createdAt).toLocaleString(dateLocale(ctx.locale))}
                </div>
              </div>
            </button>
          </Card>
        ))}
        {ctx.notifications.length === 0 && (
          <Card>
            <Empty
              icon={<IconMail size={22} />}
              title={ctx.t("الوارد فارغ", "Inbox zero")}
              hint={ctx.t("ستصلك التحديثات هنا", "Updates will land here")}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
