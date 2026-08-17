"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Avatar, Badge, Bar, Btn, Card, ScreenHeader, ScreenState, SectionTitle } from "@/components/ui";
import { IconMail, IconPlus, IconShield, IconUsers } from "@/components/icons";
import { confirmAction } from "@/components/feedback";
import { isTaskAssignedTo, getTaskEffortShare } from "@/features/tasks/assignment-domain";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-u-nu-latn" : "en-US");

function roleLabel(role: string, t: ViewCtx["t"]) {
  switch (role) {
    case "owner":
      return t("المالك", "Owner");
    case "admin":
      return t("مدير النظام", "Admin");
    case "manager":
      return t("مدير", "Manager");
    case "member":
      return t("عضو", "Member");
    case "guest":
      return t("ضيف", "Guest");
    case "viewer":
      return t("مشاهد", "Viewer");
    default:
      return role;
  }
}

function skillLabel(skill: string) {
  return skill;
}

export function MembersView({ ctx }: { ctx: ViewCtx }) {
  const [pendingMemberAction, setPendingMemberAction] = useState<string | null>(null);
  const [pendingInvitationAction, setPendingInvitationAction] = useState<string | null>(null);

  const canInviteMembers = ctx.can("members.invite");
  const canManageMembers = ctx.can("members.manage");

  const runMemberMutation = async (key: string, operation: () => Promise<unknown> | unknown) => {
    setPendingMemberAction(key);
    try {
      await operation();
    } finally {
      setPendingMemberAction(null);
    }
  };

  const runInvitationMutation = async (key: string, operation: () => Promise<unknown> | unknown) => {
    setPendingInvitationAction(key);
    try {
      await operation();
    } finally {
      setPendingInvitationAction(null);
    }
  };

  const invitationStatus = (status: string) =>
    ({
      pending: ctx.t("معلقة", "Pending"),
      resend_required: ctx.t("تحتاج إعادة إرسال", "Resend required"),
      expired: ctx.t("منتهية", "Expired"),
      accepted: ctx.t("مقبولة", "Accepted"),
      declined: ctx.t("مرفوضة", "Declined"),
      revoked: ctx.t("ملغاة", "Revoked"),
    })[status] ?? status;

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
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("الأعضاء، الصلاحيات، ومصفوفة المهارات (Skills Matrix)", "Members, Roles & Skills Matrix")}
        description={ctx.t(
          "إدارة صلاحيات RBAC وإضافة وسوم المهارات لاقتراح المسؤول الأمثل بناءً على الخبرة والعبء.",
          "Manage RBAC roles and skill tags for balanced team allocation.",
        )}
        actions={
          canInviteMembers ? (
            <Btn variant="glow" onClick={() => ctx.setShowInvite(true)}>
              <IconPlus size={15} />
              {ctx.t("دعوة عضو جديد", "Invite Member")}
            </Btn>
          ) : undefined
        }
      />

      <Card className="overflow-hidden bg-surface" glow>
        <div className="divide-y divide-line">
          {ctx.members.map((m) => {
            const userTasks = ctx.tasks.filter((t) => isTaskAssignedTo(t, m.userId));
            const hours = userTasks.reduce((a, t) => a + getTaskEffortShare(t), 0);
            const pct = Math.min(100, Math.round((hours / 40) * 100));
            const skills = m.user?.skills || [];
            return (
              <div key={m.id} className="p-5 transition hover:bg-raised/40">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-[220px] flex-1 items-center gap-3.5">
                    <Avatar src={m.user?.avatarUrl} name={m.user?.name} size={42} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-bold text-ink">{m.user?.name}</span>
                        {m.team && (
                          <span
                            className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white shadow-sm"
                            style={{ background: m.team.color }}
                          >
                            {m.team.name}
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-faint">
                        {m.user?.email} • {ctx.t("انضم في", "Joined")}{" "}
                        {new Date(m.joinedAt).toLocaleDateString(dateLocale(ctx.locale))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-[130px] text-end">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                        <span className="text-ink-faint">
                          {ctx.t("العبء", "Workload")} ({fmtNumber(hours, ctx.locale)}h):
                        </span>
                        <span
                          className={`mono tabular font-bold ${pct > 85 ? "text-rose-600 dark:text-rose-400" : pct > 60 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                        >
                          {fmtNumber(pct, ctx.locale)}%
                        </span>
                      </div>
                      <Bar value={pct} className="h-1.5" />
                    </div>

                    {canManageMembers && m.role !== "owner" ? (
                      <select
                        name="auto-field-9tponey"
                        value={m.role}
                        disabled={pendingMemberAction === `${m.id}:role`}
                        aria-busy={pendingMemberAction === `${m.id}:role`}
                        onChange={(e) =>
                          runMemberMutation(`${m.id}:role`, () => ctx.updateMemberRole(m.id, e.target.value))
                        }
                        className="h-8 rounded-xl border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink shadow-xs outline-none transition focus:border-accent disabled:opacity-50"
                      >
                        {["admin", "manager", "member", "guest", "viewer"].map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r, ctx.t)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={m.role === "owner" ? "indigo" : "neutral"}>{roleLabel(m.role, ctx.t)}</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/50 p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="me-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      {ctx.t("المهارات والخبرات:", "Skills & Expertise:")}
                    </span>
                    {skills.length > 0 ? (
                      skills.map((sk) => (
                        <span
                          key={sk}
                          className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/20 bg-surface px-2 py-0.5 text-[11px] font-semibold text-indigo-700 shadow-sm dark:text-indigo-300"
                        >
                          <span>{skillLabel(sk)}</span>
                          {m.userId === ctx.currentUser?.id && (
                            <button
                              disabled={pendingMemberAction === `${m.userId}:skills`}
                              onClick={() =>
                                runMemberMutation(`${m.userId}:skills`, () =>
                                  ctx.updateUserSkills(
                                    m.userId,
                                    skills.filter((item) => item !== sk),
                                  ),
                                )
                              }
                              className="font-bold hover:text-rose-500 disabled:opacity-50"
                              aria-label={ctx.t("حذف المهارة", "Remove skill")}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-ink-faint">
                        {ctx.t("لم تُضف مهارات بعد", "No skills added yet")}
                      </span>
                    )}
                  </div>

                  {m.userId === ctx.currentUser?.id && (
                    <div className="flex items-center gap-2">
                      <select
                        id={`sk-add-${m.userId}`}
                        disabled={pendingMemberAction === `${m.userId}:skills`}
                        onChange={(e) => {
                          if (e.target.value && !skills.includes(e.target.value)) {
                            const newSkill = e.target.value;
                            e.target.value = "";
                            runMemberMutation(`${m.userId}:skills`, () =>
                              ctx.updateUserSkills(m.userId, [...skills, newSkill]),
                            );
                          }
                        }}
                        className="h-7.5 rounded-lg border border-line bg-surface px-2 text-[11.5px] font-semibold text-ink shadow-xs outline-none transition focus:border-accent"
                      >
                        <option value="">+ {ctx.t("إضافة مهارة جديدة...", "Add skill...")}</option>
                        {allSkills
                          .filter((sk) => !skills.includes(sk))
                          .map((sk) => (
                            <option key={sk} value={sk}>
                              {skillLabel(sk)}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {ctx.members.length === 0 && (
            <div className="p-8 text-center">
              <ScreenState
                framed={false}
                tone="empty"
                title={ctx.t("لا يوجد أعضاء في المؤسسة", "No members in organization")}
                description={ctx.t(
                  "قم بدعوة أعضاء الفريق للبدء في التعاون",
                  "Invite team members to start collaborating",
                )}
              />
            </div>
          )}
        </div>
      </Card>

      {ctx.invitations.length > 0 && (
        <div className="mt-5">
          <SectionTitle count={ctx.invitations.length}>{ctx.t("دعوات معلقة", "Pending invitations")}</SectionTitle>
          <div className="space-y-2">
            {ctx.invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px]"
              >
                <span className="flex min-w-0 items-center gap-2 text-amber-900 dark:text-amber-200">
                  <IconMail size={14} />
                  <bdi dir="ltr" className="truncate">
                    {inv.email}
                  </bdi>
                </span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="text-end">
                    <div className="flex items-center justify-end gap-2">
                      <Badge tone="amber">{roleLabel(inv.role, ctx.t)}</Badge>
                      <span className="text-[10.5px] text-amber-700 dark:text-amber-400">
                        {invitationStatus(inv.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-ink-faint">
                      {ctx.t("أُرسلت", "Invited")} {new Date(inv.createdAt).toLocaleDateString(dateLocale(ctx.locale))}
                      {inv.expiresAt
                        ? ` · ${ctx.t("تنتهي", "Expires")} ${new Date(inv.expiresAt).toLocaleDateString(dateLocale(ctx.locale))}`
                        : ` · ${ctx.t("يلزم إنشاء رمز آمن", "Secure token required")}`}
                    </div>
                  </div>
                  {["pending", "expired", "resend_required"].includes(inv.status) && (
                    <>
                      {canInviteMembers && (
                        <Btn
                          size="sm"
                          variant="outline"
                          disabled={pendingInvitationAction === `${inv.id}:resend`}
                          aria-busy={pendingInvitationAction === `${inv.id}:resend`}
                          onClick={() => runInvitationMutation(`${inv.id}:resend`, () => ctx.resendInvitation(inv.id))}
                        >
                          {ctx.t("إعادة إرسال", "Resend")}
                        </Btn>
                      )}
                      {canManageMembers && (
                        <Btn
                          size="sm"
                          variant="danger"
                          disabled={pendingInvitationAction === `${inv.id}:revoke`}
                          aria-busy={pendingInvitationAction === `${inv.id}:revoke`}
                          onClick={async () => {
                            const confirmed = await confirmAction({
                              title: ctx.t("إلغاء الدعوة", "Revoke Invitation"),
                              message: ctx.t("هل تريد إلغاء هذه الدعوة؟", "Revoke this invitation?"),
                              tone: "danger",
                            });
                            if (!confirmed) return;
                            await runInvitationMutation(`${inv.id}:revoke`, () => ctx.revokeInvitation(inv.id));
                          }}
                        >
                          {ctx.t("إلغاء الدعوة", "Revoke")}
                        </Btn>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card className="mt-6 bg-surface p-5">
        <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
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
            <div key={r} className="rounded-xl border border-line bg-raised/50 p-3">
              <span className="mono text-[12px] font-bold text-indigo-600 dark:text-indigo-400">
                {roleLabel(r, ctx.t)}
              </span>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">{ctx.t(ar, en)}</div>
            </div>
          ))}
        </div>
        <p className="mt-3.5 text-[11px] leading-relaxed text-ink-faint">
          {ctx.t(
            "تُفحص كل صلاحية في الخادم لكل عملية — إخفاء الواجهة ليس إجراءً أمنياً.",
            "Every permission is verified server-side per operation — UI hiding is never a security control.",
          )}
        </p>
      </Card>
    </div>
  );
}
