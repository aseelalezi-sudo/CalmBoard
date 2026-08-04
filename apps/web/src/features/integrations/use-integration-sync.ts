import type { ViewCtx } from "@/lib/types";
import { runIntegrationSync } from "@/features/integrations/api";

export function useIntegrationSync(ctx: ViewCtx, onSynced: () => void | Promise<void>) {
  const testSync = async (providerId: string, providerName: string) => {
    if (!ctx.can("integrations.manage")) return;
    try {
      const result = await runIntegrationSync({
        provider: providerId,
        organizationId: ctx.activeOrg?.id,
        workspaceId: ctx.activeWorkspace?.id,
      });
      if (result.ok) {
        await onSynced();
        ctx.notify(`${ctx.t("تمت المزامنة بنجاح مع", "Synced successfully with")} ${providerName} ✓`);
      } else {
        ctx.notify(result.error || "Sync failed", "error");
      }
    } catch {
      ctx.notify("Network error during sync", "error");
    }
  };

  return { testSync };
}
