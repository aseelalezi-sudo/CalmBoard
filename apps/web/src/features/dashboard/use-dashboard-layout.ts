import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardWidget, Organization, Workspace } from "@/lib/types";
import { getDashboardLayout, updateDashboardLayout } from "@/features/dashboard/api";
import { defaultDashboardWidgets } from "@/features/dashboard/layout";

type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

export function useDashboardLayout({
  activeOrg,
  activeWorkspace,
  t,
  notify,
}: {
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  t: Translator;
  notify: Notify;
}) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(defaultDashboardWidgets);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const versionRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const scopeKey = `${activeOrg?.id ?? ""}:${activeWorkspace?.id ?? ""}`;
  const scopeRef = useRef(scopeKey);

  const load = useCallback(async () => {
    const requestedScopeKey = `${activeOrg?.id ?? ""}:${activeWorkspace?.id ?? ""}`;
    if (!activeOrg || !activeWorkspace) {
      if (scopeRef.current === requestedScopeKey) {
        setWidgets(defaultDashboardWidgets);
        versionRef.current = 0;
        setLoadError(null);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const layout = await getDashboardLayout({
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
      });
      if (scopeRef.current !== requestedScopeKey) return;
      setWidgets(layout.widgets);
      versionRef.current = layout.version;
    } catch (error) {
      if (scopeRef.current !== requestedScopeKey) return;
      const readableError =
        error instanceof Error ? error.message : t("تعذر تحميل تخطيط لوحة التحكم", "Could not load dashboard layout");
      setLoadError(readableError);
      notify(readableError, "error");
    } finally {
      if (scopeRef.current === requestedScopeKey) setLoading(false);
    }
  }, [activeOrg, activeWorkspace, notify, t]);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueRef.current = Promise.resolve();
    setSaving(false);
    void load();
  }, [load, scopeKey]);

  const save = (nextWidgets: DashboardWidget[]) => {
    if (!activeOrg || !activeWorkspace || loading || loadError) return;
    setWidgets(nextWidgets);
    setSaving(true);
    const scope = { organizationId: activeOrg.id, workspaceId: activeWorkspace.id };
    const requestScopeKey = scopeKey;
    queueRef.current = queueRef.current
      .then(async () => {
        const updated = await updateDashboardLayout(scope, nextWidgets, versionRef.current);
        if (scopeRef.current === requestScopeKey) versionRef.current = updated.version;
      })
      .catch(async (error) => {
        if (scopeRef.current !== requestScopeKey) return;
        notify(
          error instanceof Error ? error.message : t("تعذر حفظ تخطيط لوحة التحكم", "Could not save dashboard layout"),
          "error",
        );
        await load();
      })
      .finally(() => {
        if (scopeRef.current === requestScopeKey) setSaving(false);
      });
  };

  return {
    widgets,
    loading,
    loadError,
    saving,
    save,
    reset: () => save(defaultDashboardWidgets),
    retry: load,
  };
}
