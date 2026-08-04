import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  createAIUsageRepository,
  createAIProposalsRepository,
  createTasksRepository,
  withDatabaseContext,
  type AIUsageReservation,
  type DatabaseTenantContext,
} from "@calmboard/database";
import { AI_PROVIDER_TOKEN, type AIProvider, type AITaskContext } from "./ai-provider.js";
import { proposedTasksFromResult } from "./ai-proposal.js";
import type { AIRequestInput } from "./ai-validation.js";

function safetyIdentifier(actorId: string) {
  return createHash("sha256").update(`calmboard-ai:${actorId}`).digest("hex");
}

export function estimateAIReservationTokens(input: AIRequestInput, tasks: AITaskContext[]) {
  const payloadBytes = Buffer.byteLength(input.text, "utf8") + Buffer.byteLength(JSON.stringify(tasks), "utf8");
  // Tokenizers cannot emit more text tokens than the UTF-8 byte payload; the
  // fixed allowance covers system/action prompts, message framing, and the
  // provider's configured 1,024-token response ceiling.
  return payloadBytes + 8_192;
}

@Injectable()
export class AIService {
  constructor(@Inject(AI_PROVIDER_TOKEN) private readonly provider: AIProvider) {}

  async run(context: DatabaseTenantContext, input: AIRequestInput) {
    const requiresTasks = input.action === "summarize" || input.action === "report";
    let tasks: AITaskContext[] = [];
    let reservation!: AIUsageReservation;
    await withDatabaseContext(context, async () => {
      if (requiresTasks) {
        const page = await createTasksRepository(context).listPage({ limit: 50 });
        tasks = page.items.map((task) => ({
          serial: task.serial,
          title: task.title,
          status: task.status,
          priority: task.priority,
          progress: task.progress,
          dueDate: task.dueDate?.toISOString() ?? null,
        }));
      }
      reservation = await createAIUsageRepository(context).reserve(
        input.action,
        estimateAIReservationTokens(input, tasks),
      );
    });

    let response;
    try {
      response = await this.provider.generate({
        action: input.action,
        text: input.text,
        tasks,
        safetyIdentifier: safetyIdentifier(context.actorId!),
      });
    } catch (error) {
      await withDatabaseContext(context, () => createAIUsageRepository(context).fail(reservation, "provider_failed"));
      throw error;
    }

    await withDatabaseContext(context, () =>
      createAIUsageRepository(context).complete(
        reservation,
        {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          estimatedCostMicrousd: response.estimatedCostMicrousd,
        },
        response.provider,
        response.model,
      ),
    );
    const proposedTasks = proposedTasksFromResult(input.action, response.result);
    const proposal =
      proposedTasks && input.projectId
        ? await withDatabaseContext(context, () =>
            createAIProposalsRepository(context).create({
              projectId: input.projectId!,
              action: input.action,
              tasks: proposedTasks,
              provider: response.provider,
              model: response.model,
            }),
          )
        : undefined;
    return { result: response.result, provider: response.provider, model: response.model, proposal };
  }
}
