import { useCallback, useEffect, useState } from "react";
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
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const userId = ctx.currentUser?.id;
  const organizationId = ctx.activeOrg?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getProfileSecurityData(organizationId);
      setSessions(data.sessions);
      setBranches(data.branches);
      if (data.preferences) setPreferences(data.preferences);
      setMfa(data.mfa);
    } finally {
      setLoading(false);
    }
  }, [userId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteSessions = async (id?: string, allExceptCurrent?: boolean, all?: boolean) => {
    if (!userId) return;
    const result = await deleteProfileSessions({
      id,
      allExceptCurrent,
      all,
    });
    if (result.ok) {
      ctx.notify(result.message || "تم تسجيل الخروج بنجاح");
      if (result.revokedCurrent) {
        window.location.reload();
        return;
      }
      await load();
    }
  };

  const updatePreferences = async (patch: Partial<PreferencesItem>) => {
    if (!userId || !preferences) return;
    setPreferences({ ...preferences, ...patch });
    await updateProfilePreferences(patch);
    ctx.notify("تم حفظ تفضيلات الإشعارات");
  };

  const addBranch = async (name: string, code: string | null, city: string) => {
    if (!organizationId) return;
    await createBranch({ organizationId, name, code, city });
    ctx.notify("تمت إضافة الفرع بنجاح ✓");
    await load();
  };

  const setupMfa = async (): Promise<MfaSetup> => beginMfaSetup();

  const confirmMfa = async (code: string) => {
    const result = await enableMfa(code);
    await load();
    return result.recoveryCodes;
  };

  const turnOffMfa = async (code: string) => {
    await disableMfa(code);
    await load();
  };

  return {
    sessions,
    branches,
    preferences,
    loading,
    mfa,
    deleteSessions,
    updatePreferences,
    addBranch,
    setupMfa,
    confirmMfa,
    turnOffMfa,
  };
}
