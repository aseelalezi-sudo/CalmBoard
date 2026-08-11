"use client";

import { useEffect, useState } from "react";
import { Badge, Btn, Card, inputCls } from "@/components/ui";
import type { ViewCtx } from "@/lib/types";
import {
  cancelAccountDeletion,
  cancelOrganizationDeletion,
  getAccountDeletion,
  getOrganizationDeletion,
  scheduleAccountDeletion,
  scheduleOrganizationDeletion,
  type DeletionRequestState,
} from "./api";

function stateLabel(ctx: ViewCtx, state: DeletionRequestState) {
  const labels: Record<DeletionRequestState["status"], [string, string]> = {
    requested: ["طُلب الحذف", "Deletion requested"],
    scheduled: ["مجدول", "Scheduled"],
    processing: ["جارٍ الحذف", "Processing"],
    retry_wait: ["بانتظار إعادة المحاولة", "Waiting for retry"],
    failed: ["يحتاج تدخلاً إدارياً", "Administrator action required"],
    completed: ["مكتمل", "Completed"],
    canceled: ["ملغي", "Canceled"],
  };
  return ctx.t(...labels[state.status]);
}

function Status({ ctx, state }: { ctx: ViewCtx; state: DeletionRequestState }) {
  const cancellable = state.status === "requested" || state.status === "scheduled";
  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={state.status === "failed" ? "rose" : cancellable ? "amber" : "violet"}>
          {stateLabel(ctx, state)}
        </Badge>
        {state.scheduledFor && (
          <time className="text-xs text-slate-500 dark:text-zinc-400" dateTime={state.scheduledFor}>
            {new Date(state.scheduledFor).toLocaleString(ctx.locale === "ar" ? "ar-SA" : "en-US")}
          </time>
        )}
      </div>
      {state.processingStartedAt && (
        <p className="mt-3 text-xs leading-6 text-slate-600 dark:text-zinc-300">
          {ctx.t(
            "بدأت المعالجة ولا يمكن إلغاؤها. الحساب أو المؤسسة في وضع القراءة فقط.",
            "Processing has started and can no longer be canceled. The account or organization is read-only.",
          )}
        </p>
      )}
      {state.lastErrorSummary && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{state.lastErrorSummary}</p>
      )}
    </div>
  );
}

function ReauthenticationFields({
  ctx,
  password,
  code,
  onPassword,
  onCode,
}: {
  ctx: ViewCtx;
  password: string;
  code: string;
  onPassword: (value: string) => void;
  onCode: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-zinc-200">
          {ctx.t("كلمة المرور الحالية", "Current password")}
        </span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-zinc-200">
          {ctx.t("أو رمز المصادقة الثنائية", "Or MFA code")}
        </span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => onCode(event.target.value)}
          className={inputCls}
        />
      </label>
    </div>
  );
}

export function AccountLifecycleCard({ ctx }: { ctx: ViewCtx }) {
  const [state, setState] = useState<DeletionRequestState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAccountDeletion()
      .then(setState)
      .finally(() => setLoaded(true));
  }, []);
  const cancellable = state?.status === "requested" || state?.status === "scheduled";

  return (
    <Card className="border-rose-200 bg-white p-6 dark:border-rose-500/25 dark:bg-white/2.5">
      <h3 className="text-base font-bold text-slate-900 dark:text-white">{ctx.t("حذف الحساب", "Delete account")}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-zinc-300">
        {ctx.t(
          "سيتم إيقاف تسجيل الدخول، وإلغاء الجلسات ووسائل المصادقة، وإزالة عضوياتك وبياناتك الشخصية. سيبقى معرّف مجهول لحفظ سلامة المهام والتعليقات والمستندات المشتركة.",
          "Sign-in, sessions, authentication factors, memberships, and personal data will be removed. An anonymized principal remains so shared tasks, comments, and documents keep their history.",
        )}
      </p>
      {!loaded && <p className="mt-4 text-sm text-slate-500">{ctx.t("جارٍ تحميل الحالة…", "Loading status…")}</p>}
      {state && state.status !== "canceled" && (
        <div className="mt-4">
          <Status ctx={ctx} state={state} />
        </div>
      )}
      {cancellable ? (
        <Btn
          className="mt-4"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                await cancelAccountDeletion();
                setState(null);
                ctx.notify(ctx.t("تم إلغاء حذف الحساب.", "Account deletion was canceled."));
              } catch (error) {
                ctx.notify(
                  error instanceof Error ? error.message : ctx.t("تعذر الإلغاء.", "Cancellation failed."),
                  "error",
                );
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {ctx.t("إلغاء الطلب", "Cancel request")}
        </Btn>
      ) : !state || state.status === "canceled" ? (
        <div className="mt-5 space-y-4">
          <ReauthenticationFields ctx={ctx} password={password} code={code} onPassword={setPassword} onCode={setCode} />
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-700 dark:text-zinc-200">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              {ctx.t(
                "أفهم أن الحذف يصبح نهائياً بعد بدء المعالجة، وأن عليّ نقل ملكية المؤسسات التي أملكها وحدي أو حذفها بشكل مستقل.",
                "I understand deletion becomes final after processing starts, and I must transfer or separately delete organizations I solely own.",
              )}
            </span>
          </label>
          <Btn
            variant="danger"
            disabled={busy || !confirmed || (!password && !code)}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  setState(
                    await scheduleAccountDeletion({ ...(password ? { password } : {}), ...(code ? { code } : {}) }),
                  );
                  setPassword("");
                  setCode("");
                } catch (error) {
                  ctx.notify(
                    error instanceof Error ? error.message : ctx.t("تعذر جدولة الحذف.", "Could not schedule deletion."),
                    "error",
                  );
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {ctx.t("جدولة حذف حسابي", "Schedule account deletion")}
          </Btn>
        </div>
      ) : null}
    </Card>
  );
}

export function OrganizationLifecycleCard({ ctx }: { ctx: ViewCtx }) {
  const organization = ctx.activeOrg;
  const organizationId = organization?.id;
  const isOwner = ctx.authorization?.roles.includes("owner") ?? false;
  const [state, setState] = useState<DeletionRequestState | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmedName, setConfirmedName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!organizationId || !isOwner) return;
    void getOrganizationDeletion(organizationId)
      .then(setState)
      .catch(() => setState(null));
  }, [organizationId, isOwner]);
  if (!organization || !isOwner) return null;
  const cancellable = state?.status === "requested" || state?.status === "scheduled";
  return (
    <Card className="mt-6 border-rose-200 bg-rose-50/30 p-6 dark:border-rose-500/25 dark:bg-rose-500/5">
      <h3 className="text-base font-bold text-rose-700 dark:text-rose-300">
        {ctx.t("حذف المؤسسة نهائياً", "Permanently delete organization")}
      </h3>
      <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-zinc-300">
        {ctx.t(
          "بعد انتهاء مهلة السماح ستصبح المؤسسة للقراءة فقط، ثم تُحذف البيانات العلائقية والملفات وعمليات التكامل والفوترة وفق سياسة الاحتفاظ المعتمدة. لا يوجد تراجع بعد اكتمال الحذف.",
          "After the grace period, the organization becomes read-only. Relational data, objects, integrations, and billing resources are then removed under the approved retention policy. There is no undo after completion.",
        )}
      </p>
      {state && state.status !== "canceled" && (
        <div className="mt-4">
          <Status ctx={ctx} state={state} />
        </div>
      )}
      {cancellable ? (
        <Btn
          className="mt-4"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                await cancelOrganizationDeletion(organization.id);
                setState(null);
              } catch (error) {
                ctx.notify(
                  error instanceof Error ? error.message : ctx.t("تعذر الإلغاء.", "Cancellation failed."),
                  "error",
                );
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          {ctx.t("إلغاء حذف المؤسسة", "Cancel organization deletion")}
        </Btn>
      ) : !state || state.status === "canceled" ? (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-zinc-200">
              {ctx.t(
                `اكتب اسم المؤسسة كما هو للتأكيد: ${organization.name}`,
                `Type the exact organization name: ${organization.name}`,
              )}
            </span>
            <input
              value={confirmedName}
              onChange={(event) => setConfirmedName(event.target.value)}
              className={inputCls}
            />
          </label>
          <ReauthenticationFields ctx={ctx} password={password} code={code} onPassword={setPassword} onCode={setCode} />
          <Btn
            variant="danger"
            disabled={busy || confirmedName !== organization.name || (!password && !code)}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  setState(
                    await scheduleOrganizationDeletion(organization.id, {
                      confirmedName,
                      ...(password ? { password } : {}),
                      ...(code ? { code } : {}),
                    }),
                  );
                  setPassword("");
                  setCode("");
                } catch (error) {
                  ctx.notify(
                    error instanceof Error
                      ? error.message
                      : ctx.t("تعذر جدولة حذف المؤسسة.", "Could not schedule organization deletion."),
                    "error",
                  );
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {ctx.t("جدولة الحذف النهائي", "Schedule permanent deletion")}
          </Btn>
        </div>
      ) : null}
    </Card>
  );
}
