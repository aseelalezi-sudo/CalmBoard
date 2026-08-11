import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

export type OnboardingStep =
  "workspace_ready" | "project_created" | "task_created" | "teammate_invited" | "board_explored";

export type OnboardingProgress = {
  completedSteps: OnboardingStep[];
  dismissedAt?: string | null;
  completedAt?: string | null;
};

type Scope = { organizationId: string; workspaceId: string; userId: string; actorId?: string };

export function getOnboardingProgress(scope: Scope) {
  const query = new URLSearchParams(scope as Record<string, string>);
  return requestJson<OnboardingProgress>(`${apiServiceUrl("/onboarding")}?${query.toString()}`);
}

export function updateOnboardingProgress(
  scope: Scope,
  input: { completedSteps?: OnboardingStep[]; dismissed?: boolean },
) {
  return requestJson<OnboardingProgress>(apiServiceUrl("/onboarding"), jsonRequest("PATCH", { ...scope, ...input }));
}
