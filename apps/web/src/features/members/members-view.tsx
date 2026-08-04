"use client";
import type { ViewCtx } from "@/lib/types";
import { Avatar, Badge, Bar, Btn, Card, SectionTitle } from "@/components/ui";
import { IconMail, IconPlus, IconShield } from "@/components/icons";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-EG" : "en-US");

/* ================= Members View (Skills Matrix & Workload) ================= */
export function MembersView({ ctx }: { ctx: ViewCtx }) {
  const allSkills = [
    "React",
    "TypeScript",
    "Node.js",
    "UI/UX Design",
    "Figma",
    "DevOps",
    "AWS",
    "Security",
    "Marketing",
    "SEO",
    "Product Strategy",
    "GraphQL",
    "Python",
    "Data Analytics",
  ];
  return (
    <div className="max-w-[940px] mx-auto space-y-6 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900 dark:text-white">
            {ctx.t("الأعضاء، الصلاحيات، ومصفوفة المهارات (Skills Matrix)", "Members, Roles & Skills Matrix")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-zinc-400">
            إدارة صلاحيات RBAC وإضافة وسوم المهارات ليقوم الذكاء الاصطناعي باقتراح المسؤول الأمثل بناءً على الخبرة
            والعبء (القسم 7 & 21).
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("members.invite")} onClick={() => ctx.setShowInvite(true)}>
          <IconPlus size={15} />
          {ctx.t("دعوة عضو جديد", "Invite Member")}
        </Btn>
      </div>

      <Card className="overflow-hidden bg-white dark:bg-white/[0.025]" glow>
        <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
          {ctx.members.map((m) => {
            const userTasks = ctx.tasks.filter((t) => t.assigneeId === m.userId);
            const hours = userTasks.reduce((a, t) => a + (t.estimatedHours || 0), 0);
            const pct = Math.min(100, Math.round((hours / 40) * 100));
            const skills = m.user?.skills || ["General Work"];
            return (
              <div key={m.id} className="p-5 transition hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-[220px] flex-1 items-center gap-3.5">
                    <Avatar src={m.user?.avatarUrl} name={m.user?.name} size={42} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-bold text-slate-900 dark:text-white">
                          {m.user?.name}
                        </span>
                        {m.team && (
                          <span
                            className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white shadow-sm"
                            style={{ background: m.team.color }}
                          >
                            {m.team.name}
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                        {m.user?.email} • انضم في {new Date(m.joinedAt).toLocaleDateString(dateLocale(ctx.locale))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-[130px] text-end">
                      <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
                        <span className="text-slate-400 dark:text-zinc-500">العبء ({hours}h):</span>
                        <span
                          className={`mono tabular-nums font-bold ${pct > 85 ? "text-rose-600 dark:text-rose-400" : pct > 60 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                        >
                          {pct}%
                        </span>
                      </div>
                      <Bar value={pct} className="h-1.5" />
                    </div>

                    <select
                      name="auto-field-9tponey"
                      value={m.role}
                      disabled={m.role === "owner" || !ctx.can("members.manage")}
                      onChange={(e) => ctx.updateMemberRole(m.id, e.target.value)}
                      className="h-9 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold dark:border-white/10 dark:bg-zinc-900 px-3 text-[12px] dark:text-white outline-none disabled:opacity-50 [&>option]:bg-white dark:[&>option]:bg-zinc-900"
                    >
                      {["owner", "admin", "manager", "member", "guest", "viewer"].map((r) => (
                        <option key={r} value={r}>
                          {r.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-400 me-1">
                      🛠️ المهارات والخبرات:
                    </span>
                    {skills.map((sk) => (
                      <span
                        key={sk}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                      >
                        <span>{sk}</span>
                        <button
                          disabled={m.userId !== ctx.currentUser?.id}
                          onClick={() =>
                            ctx.updateUserSkills(
                              m.userId,
                              skills.filter((item) => item !== sk),
                            )
                          }
                          className="hover:text-rose-500 font-bold disabled:hidden"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      id={`sk-add-${m.userId}`}
                      disabled={m.userId !== ctx.currentUser?.id}
                      onChange={(e) => {
                        if (e.target.value && !skills.includes(e.target.value)) {
                          ctx.updateUserSkills(m.userId, [...skills, e.target.value]);
                          e.target.value = "";
                        }
                      }}
                      className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none disabled:hidden dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-200"
                    >
                      <option value="">+ إضافة مهارة جديدة...</option>
                      {allSkills
                        .filter((sk) => !skills.includes(sk))
                        .map((sk) => (
                          <option key={sk} value={sk}>
                            {sk}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {ctx.invitations.length > 0 && (
        <div className="mt-5">
          <SectionTitle count={ctx.invitations.length}>{ctx.t("دعوات معلقة", "Pending invitations")}</SectionTitle>
          <div className="space-y-2">
            {ctx.invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/[0.06] px-4 py-3 text-[13px]"
              >
                <span className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                  <IconMail size={14} />
                  {inv.email}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="amber">{inv.role}</Badge>
                  <span className="text-[10.5px] text-amber-700 dark:text-amber-400/70">{inv.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Card className="mt-6 p-5 bg-white dark:bg-white/[0.025]">
        <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
          <IconShield size={15} />
          <span className="text-[13px] font-semibold">{ctx.t("نموذج الصلاحيات RBAC", "RBAC Permission Model")}</span>
        </div>
        <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
          {[
            ["owner", "كل الصلاحيات + الفوترة", "All + billing"],
            ["admin", "إدارة المؤسسة والأعضاء", "Manage org & members"],
            ["manager", "إدارة المشاريع والفرق", "Manage projects"],
            ["member", "إنشاء وتعديل المهام", "Create & edit tasks"],
            ["guest", "وصول محدود", "Limited access"],
            ["viewer", "قراءة فقط", "Read-only"],
          ].map(([r, ar, en]) => (
            <div
              key={r}
              className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02] p-3"
            >
              <span className="mono text-[12px] font-bold text-indigo-600 dark:text-indigo-300">{r}</span>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">{ctx.t(ar, en)}</div>
            </div>
          ))}
        </div>
        <p className="mt-3.5 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-600">
          {ctx.t(
            "تُفحص كل صلاحية في الخادم لكل عملية — إخفاء الواجهة ليس إجراءً أمنياً.",
            "Every permission is verified server-side per operation — UI hiding is never a security control.",
          )}
        </p>
      </Card>
    </div>
  );
}
