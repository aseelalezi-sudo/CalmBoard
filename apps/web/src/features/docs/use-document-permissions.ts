import { useState } from "react";
import type { Doc, ViewCtx } from "@/lib/types";
import {
  getDocumentPermissions,
  removeDocumentPermission,
  setDocumentPermission,
  type DocumentPermission,
} from "@/features/docs/api";

export type DocumentPermissionLevel = DocumentPermission["accessLevel"];

export function useDocumentPermissions(doc: Doc | null, ctx: ViewCtx) {
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissions, setPermissions] = useState<DocumentPermission[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [permissionActionBusy, setPermissionActionBusy] = useState(false);
  const [permissionUserId, setPermissionUserId] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<DocumentPermissionLevel>("viewer");

  const loadPermissions = async () => {
    if (!doc) return;
    setShowPermissions(true);
    setLoadingPermissions(true);
    setPermissionError(null);
    try {
      setPermissions(await getDocumentPermissions(doc));
    } catch (error) {
      setPermissionError(
        error instanceof Error
          ? error.message
          : ctx.t("تعذر تحميل صلاحيات المستند", "Failed to load document permissions"),
      );
    } finally {
      setLoadingPermissions(false);
    }
  };

  const grantPermission = async () => {
    if (!doc || !permissionUserId || permissionActionBusy) return;
    setPermissionActionBusy(true);
    try {
      await setDocumentPermission(doc, permissionUserId, permissionLevel);
      setPermissionUserId("");
      setPermissions(await getDocumentPermissions(doc));
      ctx.notify(ctx.t("تم تحديث صلاحية المستند", "Document access updated"));
    } catch {
      ctx.notify(ctx.t("تعذر تحديث صلاحية المستند", "Failed to update document access"), "error");
    } finally {
      setPermissionActionBusy(false);
    }
  };

  const revokePermission = async (userId: string) => {
    if (!doc || permissionActionBusy) return;
    setPermissionActionBusy(true);
    try {
      await removeDocumentPermission(doc, userId);
      setPermissions((current) => current.filter((permission) => permission.userId !== userId));
      ctx.notify(ctx.t("تمت إزالة الصلاحية", "Access removed"));
    } catch {
      ctx.notify(ctx.t("تعذر إزالة الصلاحية", "Failed to remove access"), "error");
    } finally {
      setPermissionActionBusy(false);
    }
  };

  return {
    showPermissions,
    setShowPermissions,
    permissions,
    loadingPermissions,
    permissionError,
    permissionActionBusy,
    permissionUserId,
    setPermissionUserId,
    permissionLevel,
    setPermissionLevel,
    loadPermissions,
    grantPermission,
    revokePermission,
  };
}
