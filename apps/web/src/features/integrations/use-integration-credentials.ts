import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { confirmAction } from "@/components/feedback";
import {
  disconnectOAuthIntegration,
  integrationOAuthProviders,
  integrationOAuthStartUrl,
  listIntegrationCredentials,
  type IntegrationCredentialSummary,
  type IntegrationOAuthProvider,
  type IntegrationOAuthAvailability,
} from "@/features/integrations/api";

export type { IntegrationOAuthProvider } from "@/features/integrations/api";

const unavailableProviders: IntegrationOAuthAvailability = {
  github: false,
  slack: false,
  gcal: false,
  microsoft: false,
};

export function useIntegrationCredentials(ctx: ViewCtx) {
  const [credentials, setCredentials] = useState<IntegrationCredentialSummary[]>([]);
  const [availability, setAvailability] = useState<IntegrationOAuthAvailability>(unavailableProviders);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<IntegrationOAuthProvider | null>(null);

  const refresh = useCallback(async () => {
    if (!ctx.can("integrations.manage") || !ctx.activeOrg?.id || !ctx.activeWorkspace?.id || !ctx.currentUser?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [listedCredentials, providerAvailability] = await Promise.all([
        listIntegrationCredentials({
          organizationId: ctx.activeOrg.id,
          workspaceId: ctx.activeWorkspace.id,
          actorId: ctx.currentUser.id,
        }),
        integrationOAuthProviders(),
      ]);
      setCredentials(listedCredentials);
      setAvailability(providerAvailability);
    } catch (error) {
      const readableError =
        error instanceof Error
          ? error.message
          : ctx.t("تعذر تحميل حالة التكاملات", "Unable to load integration status");
      setLoadError(readableError);
      ctx.notify(readableError, "error");
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const status = query.get("integration_oauth");
    if (status !== "success" && status !== "error") return;
    if (status === "success") {
      void refresh();
      ctx.notify(ctx.t("تم ربط التكامل بنجاح", "Integration connected successfully"));
    } else {
      ctx.notify(ctx.t("تعذر إكمال ربط التكامل", "Unable to complete integration connection"), "error");
    }
    query.delete("integration_oauth");
    query.delete("provider");
    query.delete("reason");
    const cleanUrl = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", cleanUrl);
  }, [ctx, refresh]);

  const credentialByProvider = useMemo(
    () =>
      new Map(
        credentials
          .filter((credential) => credential.status === "active")
          .map((credential) => [credential.provider, credential]),
      ),
    [credentials],
  );

  const toggle = async (provider: IntegrationOAuthProvider) => {
    if (!ctx.can("integrations.manage") || pendingProvider !== null) return;
    if (!ctx.activeOrg?.id || !ctx.activeWorkspace?.id || !ctx.currentUser?.id) return;
    const credential = credentialByProvider.get(provider);
    if (!credential && !availability[provider]) {
      ctx.notify(ctx.t("هذا التكامل غير مهيأ على الخادم", "This integration is not configured on the server"), "error");
      return;
    }
    if (!credential) {
      window.location.assign(
        integrationOAuthStartUrl(provider, {
          organizationId: ctx.activeOrg.id,
          workspaceId: ctx.activeWorkspace.id,
          actorId: ctx.currentUser.id,
        }),
      );
      return;
    }

    const confirmed = await confirmAction({
      title: ctx.t("فصل التكامل", "Disconnect integration"),
      message: ctx.t(
        "هل أنت متأكد من فصل هذا التكامل وإبطال رموز الوصول الخاصة به؟",
        "Are you sure you want to disconnect this integration and revoke its access tokens?",
      ),
      tone: "danger",
    });
    if (!confirmed) return;

    setPendingProvider(provider);
    try {
      await disconnectOAuthIntegration(provider, {
        organizationId: ctx.activeOrg.id,
        workspaceId: ctx.activeWorkspace.id,
        actorId: ctx.currentUser.id,
      });
      setCredentials((current) => current.filter((item) => item.id !== credential.id));
      ctx.notify(ctx.t("تم فصل التكامل وإبطال اعتماده", "Integration disconnected and credential revoked"));
    } catch {
      ctx.notify(ctx.t("تعذر فصل التكامل", "Unable to disconnect integration"), "error");
    } finally {
      setPendingProvider(null);
    }
  };

  return { availability, credentialByProvider, loading, loadError, pendingProvider, toggle, refresh };
}
