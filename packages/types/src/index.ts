export type ServiceName = "web" | "api" | "worker";

export type HealthResponse = {
  ok: boolean;
  service: ServiceName;
  timestamp: string;
};

export type TenantScope = {
  organizationId: string;
  workspaceId?: string;
};
