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
  const [permissionUserId, setPermissionUserId] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<DocumentPermissionLevel>("viewer");

  const loadPermissions = async () => {
    if (!doc) return;
    setShowPermissions(true);
    setLoadingPermissions(true);
    try {
      setPermissions(await getDocumentPermissions(doc));
    } catch {
      ctx.notify(ctx.t("تعذر تحميل صلاحيات المستند", "Failed to load document permissions"), "error");
      setShowPermissions(false);
    } finally {
      setLoadingPermissions(false);
    }
  };

  const grantPermission = async () => {
    if (!doc || !permissionUserId) return;
    try {
      await setDocumentPermission(doc, permissionUserId, permissionLevel);
      setPermissionUserId("");
      setPermissions(await getDocumentPermissions(doc));
      ctx.notify(ctx.t("تم تحديث صلاحية المستند", "Document access updated"));
    } catch {
      ctx.notify(ctx.t("تعذر تحديث صلاحية المستند", "Failed to update document access"), "error");
    }
  };

  const revokePermission = async (userId: string) => {
    if (!doc) return;
    try {
      await removeDocumentPermission(doc, userId);
      setPermissions((current) => current.filter((permission) => permission.userId !== userId));
    } catch {
      ctx.notify(ctx.t("تعذر إزالة الصلاحية", "Failed to remove access"), "error");
    }
  };

  return {
    showPermissions,
    setShowPermissions,
    permissions,
    loadingPermissions,
    permissionUserId,
    setPermissionUserId,
    permissionLevel,
    setPermissionLevel,
    loadPermissions,
    grantPermission,
    revokePermission,
  };
}
