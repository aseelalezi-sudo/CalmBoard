import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SavedView, SavedViewConfiguration } from "@/lib/types";
import { deleteSavedViewRecord, updateSavedViewRecord } from "@/features/workspace/saved-views-api";

type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

export function useSavedViewOperations(input: {
  organizationId?: string;
  workspaceId?: string;
  actorId?: string;
  setSavedViews: Dispatch<SetStateAction<SavedView[]>>;
  t: Translator;
  notify: Notify;
}) {
  const { organizationId, workspaceId, actorId, setSavedViews, t, notify } = input;
  const scope = useMemo(
    () => (organizationId && workspaceId ? { organizationId, workspaceId, actorId } : null),
    [actorId, organizationId, workspaceId],
  );

  const update = useCallback(
    async (
      view: SavedView,
      updates: Partial<{
        name: string;
        filters: Record<string, string | undefined>;
        configuration: SavedViewConfiguration;
        isShared: boolean;
        isDefault: boolean;
      }>,
    ) => {
      if (!scope) return null;
      try {
        const updated = await updateSavedViewRecord(scope, view, updates);
        setSavedViews((current) =>
          current.map((candidate) => {
            if (updated.isDefault && candidate.projectId === updated.projectId) {
              return candidate.id === updated.id ? updated : { ...candidate, isDefault: false };
            }
            return candidate.id === updated.id ? updated : candidate;
          }),
        );
        notify(t("تم تحديث العرض المحفوظ", "Saved view updated"));
        return updated;
      } catch {
        notify(t("تعذر تحديث العرض المحفوظ", "Failed to update saved view"), "error");
        return null;
      }
    },
    [notify, scope, setSavedViews, t],
  );

  const remove = useCallback(
    async (view: SavedView) => {
      if (!scope) return false;
      try {
        await deleteSavedViewRecord(scope, view.id);
        setSavedViews((current) => current.filter((candidate) => candidate.id !== view.id));
        notify(t("حُذف العرض المحفوظ", "Saved view deleted"));
        return true;
      } catch {
        notify(t("تعذر حذف العرض المحفوظ", "Failed to delete saved view"), "error");
        return false;
      }
    },
    [notify, scope, setSavedViews, t],
  );

  return { updateSavedView: update, deleteSavedView: remove };
}
