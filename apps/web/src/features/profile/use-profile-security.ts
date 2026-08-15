import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewCtx } from "@/lib/types";
import {
  createBranch,
  beginMfaSetup,
  deleteProfileSessions,
  disableMfa,
  enableMfa,
  getProfileSecurityData,
  updateProfilePreferences,
  type BranchItem,
  type PreferencesItem,
  type SessionItem,
  type MfaSetup,
  type MfaStatus,
} from "@/features/profile/api";

export function useProfileSecurity(ctx: ViewCtx) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [preferences, setPreferences] = useState<PreferencesItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);

  const pendingActionRef = useRef(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const userId = ctx.currentUser?.id;
  const organizationId = ctx.activeOrg?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getProfileSecurityData(organizationId);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setSessions(data.sessions);
      setBranches(data.branches);
      if (data.preferences) setPreferences(data.preferences);
      setMfa(data.mfa);
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadError("تعذر تحميل إعدادات الحساب والأمان. تحقق من الاتصال.");
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId, organizationId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [load]);

  const deleteSessions = async (id?: string, allExceptCurrent?: boolean, all?: boolean) => {
    if (pendingActionRef.current) return null;
    if (!userId) return false;
    pendingActionRef.current = true;
    setPendingAction("delete_sessions");
    try {
      const result = await deleteProfileSessions({
        id,
        allExceptCurrent,
        all,
      });
      if (!result.ok) throw new Error("revoke_failed");
      ctx.notify(result.message || ctx.t("تم إنهاء الجلسات بنجاح.", "Sessions revoked successfully."));
      if (result.revokedCurrent) {
        window.location.reload();
        return true;
      }
      await load();
      return true;
    } catch {
      ctx.notify(
        ctx.t("تعذر إنهاء الجلسات. لم تتغير الجلسات النشطة.", "Could not revoke sessions. Active sessions unchanged."),
        "error",
      );
      return false;
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };

  const updatePreferences = async (patch: Partial<PreferencesItem>) => {
    if (pendingActionRef.current) return null;
    if (!userId || !preferences) return false;
    pendingActionRef.current = true;
    setPendingAction("update_preferences");
    const previous = preferences;
    setPreferences({ ...preferences, ...patch });
    try {
      await updateProfilePreferences(patch);
      ctx.notify(ctx.t("تم حفظ تفضيلات الإشعارات.", "Notification preferences saved."));
      return true;
    } catch {
      setPreferences(previous);
      ctx.notify(
        ctx.t(
          "تعذر حفظ التفضيلات. تمت استعادة الإعدادات السابقة.",
          "Could not save preferences. Previous settings restored.",
        ),
        "error",
      );
      return false;
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };

  const addBranch = async (name: string, code: string | null, city: string) => {
    if (pendingActionRef.current) return null;
    if (!organizationId) return false;
    pendingActionRef.current = true;
    setPendingAction("add_branch");
    try {
      await createBranch({ organizationId, name, code, city });
      ctx.notify(ctx.t("تمت إضافة الفرع بنجاح.", "Branch added successfully."));
      await load();
      return true;
    } catch {
      ctx.notify(
        ctx.t("تعذر إضافة الفرع. تحقق من البيانات والاتصال.", "Could not add branch. Check details and connection."),
        "error",
      );
      return false;
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };

  const setupMfa = async (): Promise<MfaSetup> => beginMfaSetup();

  const confirmMfa = async (code: string) => {
    if (pendingActionRef.current) return null;
    pendingActionRef.current = true;
    setPendingAction("confirm_mfa");
    try {
      const result = await enableMfa(code);
      await load();
      return result.recoveryCodes;
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر تفعيل المصادقة الثنائية. تحقق من الرمز وحاول مجدداً.",
          "Could not enable 2FA. Check code and try again.",
        ),
        "error",
      );
      return null;
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };

  const turnOffMfa = async (code: string) => {
    if (pendingActionRef.current) return null;
    pendingActionRef.current = true;
    setPendingAction("disable_mfa");
    try {
      await disableMfa(code);
      await load();
      return true;
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر تعطيل المصادقة الثنائية. تحقق من الرمز وحاول مجدداً.",
          "Could not disable 2FA. Check code and try again.",
        ),
        "error",
      );
      return false;
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };

  const reload = () => load();

  return {
    sessions,
    branches,
    preferences,
    loading,
    loadError,
    pendingAction,
    mfa,
    reload,
    deleteSessions,
    updatePreferences,
    addBranch,
    setupMfa,
    confirmMfa,
    turnOffMfa,
  };
}
