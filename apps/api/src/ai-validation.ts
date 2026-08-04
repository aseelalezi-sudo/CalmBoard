import { BadRequestException } from "@nestjs/common";
import { AI_ACTIONS, type AIAction } from "./ai-provider.js";
import { isJsonObject, requiredString, type JsonObject } from "./request-validation.js";

const actions = new Set<string>(AI_ACTIONS);
const actionsRequiringText = new Set<AIAction>([
  "breakdown",
  "meeting_notes",
  "priority",
  "translate",
  "generate_task",
]);
const actionsRequiringProject = new Set<AIAction>(["breakdown", "meeting_notes", "generate_task"]);
export const MAX_AI_INPUT_LENGTH = 20_000;

export type AIRequestInput = { action: AIAction; text: string; projectId?: string };

export function parseAIRequest(body: JsonObject): AIRequestInput {
  if (!isJsonObject(body)) throw new BadRequestException("request body must be an object");
  const action = requiredString(body.action, "action");
  if (!actions.has(action)) throw new BadRequestException("action is invalid");
  const typedAction = action as AIAction;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (actionsRequiringText.has(typedAction) && !text) throw new BadRequestException("text is required for this action");
  if (text.length > MAX_AI_INPUT_LENGTH) {
    throw new BadRequestException(`text must not exceed ${MAX_AI_INPUT_LENGTH} characters`);
  }
  const projectId = body.projectId === undefined ? undefined : requiredString(body.projectId, "projectId");
  if (actionsRequiringProject.has(typedAction) && !projectId) {
    throw new BadRequestException("projectId is required for this action");
  }
  return { action: typedAction, text, ...(projectId ? { projectId } : {}) };
}
