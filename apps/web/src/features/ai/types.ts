export type AIProposedTask = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedHours?: number;
};

export type AIActionProposal = {
  id: string;
  projectId: string;
  digest: string;
  expiresAt: string;
  kind: "create_tasks";
  tasks: AIProposedTask[];
};
