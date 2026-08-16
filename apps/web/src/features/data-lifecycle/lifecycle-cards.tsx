"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Btn, Card, inputCls, ScreenState } from "@/components/ui";
import { IconRotateCw } from "@/components/icons";
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
    <div className="rounded-xl border border-line bg-raised/40 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={state.status === "failed" ? "rose" : cancellable ? "amber" : "violet"}>
          {stateLabel(ctx, state)}
        </Badge>
        {state.scheduledFor && (
          <time className="text-xs text-ink-faint" dateTime={state.scheduledFor}>
            {new Date(state.scheduledFor).toLocaleString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}
          </time>
        )}
      </div>
      {state.processingStartedAt && (
        <p className="mt-3 text-xs leading-6 text-ink-soft">
          {ctx.t(
            "بدأت المعالجة ولا يمكن إلغاؤها. الحساب أو المؤسسة في وضع القراءة فقط.",
            "Processing has started and can no longer be canceled. The account or organization is read-only.",
          )}
        </p>
      )}
      {state.lastErrorSummary && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {ctx.t(
            "تعذرت محاولة المعالجة الأخيرة. سيعيد النظام المحاولة أو يتطلب مراجعة الدعم.",
            "The latest processing attempt failed. The system will retry or requires administrative assistance.",
          )}
        </p>
      )}
    </div>
  );
}

function ReauthenticationFields({
  ctx,
  password,
  code,
  disabled,
  onPassword,
  onCode,
}: {
  ctx: ViewCtx;
  password: string;
  code: string;
  disabled?: boolean;
  onPassword: (value: string) => void;
  onCode: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink-soft">
          {ctx.t("كلمة المرور الحالية", "Current password")}
        </span>
        <input
          type="password"
          disabled={disabled}
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-ink-soft">
          {ctx.t("أو رمز المصادقة الثنائية", "Or MFA code")}
        </span>
        <input
          inputMode="numeric"
          maxLength={8}
          disabled={disabled}
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          className={inputCls}
        />
      </label>
    </div>
  );
}

export function AccountLifecycleCard({ ctx }: { ctx: ViewCtx }) {
  const [state, setState] = useState<DeletionRequestState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let current = true;
    setLoaded(false);
    setLoadError(null);
    void getAccountDeletion()
      .then((nextState) => {
        if (current) setState(nextState);
      })
      .catch((error) => {
        if (current) {
          setLoadError(ctx.t("تعذر تحميل حالة حذف الحساب", "Could not load account deletion status"));
        }
      })
      .finally(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [reloadKey, ctx]);

  const cancellable = state?.status === "requested" || state?.status === "scheduled";

  return (
    <Card className="border-rose-200 bg-surface p-6 dark:border-rose-500/25">
      <h3 className="text-base font-bold text-ink">{ctx.t("حذف الحساب", "Delete account")}</h3>
      <p className="mt-2 text-sm leading-7 text-ink-soft">
        {ctx.t(
          "سيتم إيقاف تسجيل الدخول، وإلغاء الجلسات ووسائل المصادقة، وإزالة عضوياتك وبياناتك الشخصية. سيبقى معرّف مجهول لحفظ سلامة المهام والتعليقات والمستندات المشتركة.",
          "Sign-in, sessions, authentication factors, memberships, and personal data will be removed. An anonymized principal remains so shared tasks, comments, and documents keep their history.",
        )}
      </p>

      {!loaded && (
        <div className="mt-4">
          <ScreenState
            framed={false}
            tone="loading"
            title={ctx.t("جارٍ تحميل حالة الحساب…", "Loading account status…")}
            description={ctx.t(
              "يرجى الانتظار بينما نتأكد من حالة طلبات الحذف.",
              "Checking account deletion request state.",
            )}
          />
        </div>
      )}

      {loaded && loadError && (
        <div className="mt-4">
          <ScreenState
            framed={false}
            tone="error"
            title={ctx.t("تعذر تحميل حالة الحساب", "Could not load account status")}
            description={loadError}
            action={
              <Btn variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
                <IconRotateCw size={14} />
                {ctx.t("إعادة المحاولة", "Retry")}
              </Btn>
            }
          />
        </div>
      )}

      {loaded && !loadError && state && state.status !== "canceled" && (
        <div className="mt-4">
          <Status ctx={ctx} state={state} />
        </div>
      )}

      {loaded &&
        !loadError &&
        (cancellable ? (
          <Btn
            className="mt-4"
            variant="outline"
            disabled={busy}
            aria-busy={busy}
            onClick={() =>
              void (async () => {
                if (busyRef.current) return;
                busyRef.current = true;
                setBusy(true);
                try {
                  await cancelAccountDeletion();
                  setState(null);
                  ctx.notify(ctx.t("تم إلغاء حذف الحساب.", "Account deletion was canceled."));
                } catch {
                  ctx.notify(ctx.t("تعذر إلغاء طلب حذف الحساب.", "Could not cancel account deletion."), "error");
                } finally {
                  busyRef.current = false;
                  setBusy(false);
                }
              })()
            }
          >
            {ctx.t("إلغاء الطلب", "Cancel request")}
          </Btn>
        ) : !state || state.status === "canceled" ? (
          <div className="mt-5 space-y-4">
            <ReauthenticationFields
              ctx={ctx}
              password={password}
              code={code}
              disabled={busy}
              onPassword={setPassword}
              onCode={setCode}
            />
            <label className="flex items-start gap-3 text-sm leading-6 text-ink-soft">
              <input
                type="checkbox"
                disabled={busy}
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
              aria-busy={busy}
              onClick={() =>
                void (async () => {
                  if (busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  try {
                    setState(
                      await scheduleAccountDeletion({ ...(password ? { password } : {}), ...(code ? { code } : {}) }),
                    );
                    setPassword("");
                    setCode("");
                  } catch {
                    ctx.notify(
                      ctx.t(
                        "تعذر جدولة حذف الحساب. تحقق من بيانات التأكيد والمصادقة.",
                        "Could not schedule account deletion. Check your confirmation details and credentials.",
                      ),
                      "error",
                    );
                  } finally {
                    busyRef.current = false;
                    setBusy(false);
                  }
                })()
              }
            >
              {ctx.t("جدولة حذف حسابي", "Schedule account deletion")}
            </Btn>
          </div>
        ) : null)}
    </Card>
  );
}

export function OrganizationLifecycleCard({ ctx }: { ctx: ViewCtx }) {
  const organization = ctx.activeOrg;
  const organizationId = organization?.id;
  const isOwner = ctx.authorization?.roles.includes("owner") ?? false;
  const [state, setState] = useState<DeletionRequestState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmedName, setConfirmedName] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const organizationIdRef = useRef(organizationId);

  useEffect(() => {
    organizationIdRef.current = organizationId;
    setState(null);
    setConfirmedName("");
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !isOwner) {
      setLoaded(true);
      return;
    }
    let current = true;
    setLoaded(false);
    setLoadError(null);
    void getOrganizationDeletion(organizationId)
      .then((nextState) => {
        if (current) setState(nextState);
      })
      .catch(() => {
        if (current) {
          setLoadError(ctx.t("تعذر تحميل حالة حذف المؤسسة", "Could not load organization deletion status"));
        }
      })
      .finally(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [organizationId, isOwner, reloadKey, ctx]);

  if (!organization || !isOwner) return null;
  const cancellable = state?.status === "requested" || state?.status === "scheduled";

  return (
    <Card className="mt-6 border-rose-200 bg-rose-50/20 p-6 dark:border-rose-500/25 dark:bg-rose-500/5">
      <h3 className="text-base font-bold text-rose-700 dark:text-rose-300">
        {ctx.t("حذف المؤسسة نهائياً", "Permanently delete organization")}
      </h3>
      <p className="mt-2 text-sm leading-7 text-ink-soft">
        {ctx.t(
          "بعد انتهاء مهلة السماح ستصبح المؤسسة للقراءة فقط، ثم تُحذف البيانات العلائقية والملفات وعمليات التكامل والفوترة وفق سياسة الاحتفاظ المعتمدة. لا يوجد تراجع بعد اكتمال الحذف.",
          "After the grace period, the organization becomes read-only. Relational data, objects, integrations, and billing resources are then removed under the approved retention policy. There is no undo after completion.",
        )}
      </p>

      {!loaded && (
        <div className="mt-4">
          <ScreenState
            framed={false}
            tone="loading"
            title={ctx.t("جارٍ تحميل حالة المؤسسة…", "Loading organization status…")}
            description={ctx.t(
              "يرجى الانتظار بينما نتأكد من حالة طلبات الحذف.",
              "Checking organization deletion request state.",
            )}
          />
        </div>
      )}

      {loaded && loadError && (
        <div className="mt-4">
          <ScreenState
            framed={false}
            tone="error"
            title={ctx.t("تعذر تحميل حالة المؤسسة", "Could not load organization status")}
            description={loadError}
            action={
              <Btn variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
                <IconRotateCw size={14} />
                {ctx.t("إعادة المحاولة", "Retry")}
              </Btn>
            }
          />
        </div>
      )}

      {loaded && !loadError && state && state.status !== "canceled" && (
        <div className="mt-4">
          <Status ctx={ctx} state={state} />
        </div>
      )}

      {loaded &&
        !loadError &&
        (cancellable ? (
          <Btn
            className="mt-4"
            variant="outline"
            disabled={busy}
            aria-busy={busy}
            onClick={() =>
              void (async () => {
                if (busyRef.current) return;
                if (organizationIdRef.current !== organization.id) return;
                busyRef.current = true;
                setBusy(true);
                try {
                  await cancelOrganizationDeletion(organization.id);
                  setState(null);
                  ctx.notify(ctx.t("تم إلغاء حذف المؤسسة.", "Organization deletion was canceled."));
                } catch {
                  ctx.notify(ctx.t("تعذر إلغاء حذف المؤسسة.", "Could not cancel organization deletion."), "error");
                } finally {
                  busyRef.current = false;
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
              <span className="mb-1.5 block text-xs font-semibold text-ink-soft">
                {ctx.t(
                  `اكتب اسم المؤسسة كما هو للتأكيد: ${organization.name}`,
                  `Type the exact organization name: ${organization.name}`,
                )}
              </span>
              <input
                value={confirmedName}
                disabled={busy}
                onChange={(event) => setConfirmedName(event.target.value)}
                className={inputCls}
              />
            </label>
            <ReauthenticationFields
              ctx={ctx}
              password={password}
              code={code}
              disabled={busy}
              onPassword={setPassword}
              onCode={setCode}
            />
            <Btn
              variant="danger"
              disabled={busy || confirmedName !== organization.name || (!password && !code)}
              aria-busy={busy}
              onClick={() =>
                void (async () => {
                  if (busyRef.current) return;
                  if (organizationIdRef.current !== organization.id) return;
                  busyRef.current = true;
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
                  } catch {
                    ctx.notify(
                      ctx.t(
                        "تعذر جدولة حذف المؤسسة. تحقق من الاسم وتفاصيل التأكيد.",
                        "Could not schedule organization deletion. Check the name and confirmation details.",
                      ),
                      "error",
                    );
                  } finally {
                    busyRef.current = false;
                    setBusy(false);
                  }
                })()
              }
            >
              {ctx.t("جدولة الحذف النهائي", "Schedule permanent deletion")}
            </Btn>
          </div>
        ) : null)}
    </Card>
  );
}
