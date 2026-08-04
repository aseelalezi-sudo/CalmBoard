import { z } from "zod";

export const tenantScopeSchema = z.object({
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
});

export type TenantScopeInput = z.infer<typeof tenantScopeSchema>;

export { z };
