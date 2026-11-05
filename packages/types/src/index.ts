export type ServiceName = "web" | "api" | "worker";

export const COMMENT_REACTION_EMOJIS = ["👍", "❤️", "🎉", "🚀", "👀"] as const;

export type HealthResponse = {
  ok: boolean;
  service: ServiceName;
  timestamp: string;
};

export type TenantScope = {
  organizationId: string;
  workspaceId?: string;
};
