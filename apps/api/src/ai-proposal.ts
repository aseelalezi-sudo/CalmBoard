import type { AIProposedTask } from "@calmboard/database";
import type { AIAction } from "./ai-provider.js";

const proposalActions = new Set<AIAction>(["breakdown", "meeting_notes", "generate_task"]);
const priorities = new Set<AIProposedTask["priority"]>(["low", "medium", "high", "urgent"]);

export function requiresAIProposal(action: AIAction) {
  return proposalActions.has(action);
}

export function proposedTasksFromResult(action: AIAction, result: unknown): AIProposedTask[] | undefined {
  if (!requiresAIProposal(action)) return undefined;
  if (action === "generate_task") {
    if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
    const value = result as Record<string, unknown>;
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 200) : "";
    if (!title) return undefined;
    const description = typeof value.description === "string" ? value.description.trim().slice(0, 10_000) : "";
    const priority =
      typeof value.priority === "string" && priorities.has(value.priority as AIProposedTask["priority"])
        ? (value.priority as AIProposedTask["priority"])
        : "medium";
    const estimatedHours =
      typeof value.estimatedHours === "number" && Number.isFinite(value.estimatedHours)
        ? Math.min(Math.max(value.estimatedHours, 0), 100_000)
        : undefined;
    return [{ title, description, priority, ...(estimatedHours === undefined ? {} : { estimatedHours }) }];
  }
  if (!Array.isArray(result)) return undefined;
  const tasks = result
    .filter((item): item is string => typeof item === "string")
    .map((title) => title.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 50)
    .map((title) => ({ title, description: "", priority: "medium" as const }));
  return tasks.length ? tasks : undefined;
}
