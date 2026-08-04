import { sanitizeAIProviderRequest } from "./ai-privacy.js";

export const AI_ACTIONS = [
  "breakdown",
  "summarize",
  "report",
  "meeting_notes",
  "priority",
  "translate",
  "generate_task",
] as const;

export type AIAction = (typeof AI_ACTIONS)[number];

export type AITaskContext = {
  serial: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  dueDate: string | null;
};

export type AIProviderRequest = {
  action: AIAction;
  text: string;
  tasks: AITaskContext[];
  safetyIdentifier: string;
};

export type AIProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AIProviderResponse = {
  result: unknown;
  provider: string;
  model: string;
  usage: AIProviderUsage;
  estimatedCostMicrousd: number;
};

export interface AIProvider {
  readonly provider: string;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export class AIProviderUnavailableError extends Error {
  constructor(message = "AI provider is not configured or currently unavailable") {
    super(message);
    this.name = "AIProviderUnavailableError";
  }
}

export const AI_PROVIDER_TOKEN = Symbol("AI_PROVIDER_TOKEN");

type FetchImplementation = typeof fetch;
type AIProviderEnvironment = Partial<
  Record<
    "OPENAI_API_KEY" | "OPENAI_MODEL" | "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL" | "AI_MODEL_PRICING_JSON",
    string | undefined
  >
>;

type AIModelPricing = { inputUsdPerMillion: number; outputUsdPerMillion: number };

function requiredModel(provider: string, model: string | undefined) {
  const normalized = model?.trim();
  if (!normalized) throw new AIProviderUnavailableError(`${provider} model is not configured`);
  return normalized;
}

function requiredModelPricing(environment: AIProviderEnvironment, provider: string, model: string): AIModelPricing {
  let pricing: unknown;
  try {
    pricing = JSON.parse(environment.AI_MODEL_PRICING_JSON?.trim() || "{}");
  } catch {
    throw new AIProviderUnavailableError("AI model pricing is not valid JSON");
  }
  const entry =
    pricing && typeof pricing === "object" && !Array.isArray(pricing)
      ? (pricing as Record<string, unknown>)[`${provider}:${model}`]
      : undefined;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new AIProviderUnavailableError(`Pricing is not configured for ${provider}:${model}`);
  }
  const inputUsdPerMillion = (entry as Record<string, unknown>).inputUsdPerMillion;
  const outputUsdPerMillion = (entry as Record<string, unknown>).outputUsdPerMillion;
  for (const [name, value] of Object.entries({ inputUsdPerMillion, outputUsdPerMillion })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      throw new AIProviderUnavailableError(`${provider}:${model} ${name} must be a non-negative number`);
    }
  }
  return { inputUsdPerMillion: inputUsdPerMillion as number, outputUsdPerMillion: outputUsdPerMillion as number };
}

function estimatedCostMicrousd(usage: AIProviderUsage, pricing: AIModelPricing) {
  return Math.round(usage.inputTokens * pricing.inputUsdPerMillion + usage.outputTokens * pricing.outputUsdPerMillion);
}

function taskContext(tasks: AITaskContext[]) {
  return JSON.stringify(tasks.slice(0, 50));
}

function promptFor(request: AIProviderRequest) {
  const prompts: Record<AIAction, string> = {
    breakdown: `قسّم مبادرة العمل التالية إلى خطوات عربية واضحة وقابلة للتنفيذ. أعد خطوة واحدة في كل سطر:\n\n${request.text}`,
    summarize: `لخّص حالة المهام التالية في نظرة تنفيذية عربية، مع الإنجازات والمخاطر والخطوات التالية:\n\n${taskContext(request.tasks)}`,
    report: `أنشئ تقرير حالة تنفيذي أسبوعي باللغة العربية من المهام التالية، مع الإنجازات والمخاطر والقرارات المطلوبة:\n\n${taskContext(request.tasks)}`,
    meeting_notes: `استخرج عناصر العمل القابلة للتنفيذ باللغة العربية من ملاحظات الاجتماع التالية، عنصراً واحداً في كل سطر:\n\n${request.text}`,
    priority: `اقترح أولوية واحدة فقط من low أو medium أو high أو urgent، ثم اشرح السبب بإيجاز بالعربية:\n\n${request.text}`,
    translate: `ترجم النص التالي باحتراف بين العربية والإنجليزية مع الحفاظ على المعنى والتنسيق:\n\n${request.text}`,
    generate_task: `اقترح مهمة بصيغة JSON فقط بالمفاتيح title وdescription وpriority وestimatedHours. الأولوية واحدة من low أو medium أو high أو urgent:\n\n${request.text}`,
  };
  return prompts[request.action];
}

function boundedTokens(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^[-•\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function generatedTask(value: string) {
  try {
    const parsed = JSON.parse(value.replace(/```json|```/gi, "").trim()) as Record<string, unknown>;
    const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 10_000) : "";
    const allowedPriorities = new Set(["low", "medium", "high", "urgent"]);
    const priority =
      typeof parsed.priority === "string" && allowedPriorities.has(parsed.priority) ? parsed.priority : "medium";
    const estimatedHours =
      typeof parsed.estimatedHours === "number" && Number.isFinite(parsed.estimatedHours)
        ? Math.min(Math.max(parsed.estimatedHours, 0), 10_000)
        : undefined;
    if (!title) throw new Error("title is missing");
    return { title, description, priority, ...(estimatedHours === undefined ? {} : { estimatedHours }) };
  } catch {
    return { title: value.trim().slice(0, 200), description: value.trim().slice(0, 10_000), priority: "medium" };
  }
}

function resultFor(action: AIAction, content: string) {
  const normalized = content.trim();
  if (!normalized) throw new AIProviderUnavailableError("AI provider returned an empty response");
  if (action === "breakdown" || action === "meeting_notes") return lines(normalized);
  if (action === "priority") {
    const match = normalized.toLowerCase().match(/\b(urgent|high|medium|low)\b/);
    return { result: match?.[1] ?? "medium", reason: normalized.slice(0, 2_000) };
  }
  if (action === "generate_task") return generatedTask(normalized);
  return normalized;
}

class OpenAIProvider implements AIProvider {
  readonly provider = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly pricing: AIModelPricing,
    private readonly fetchImplementation: FetchImplementation,
  ) {}

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const response = await this.fetchImplementation("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "أنت مساعد CalmBoard لإدارة العمل. أعد اقتراحات فقط، ولا تدّع تنفيذ أي تغيير أو استدعاء أي أداة.",
          },
          { role: "user", content: promptFor(request) },
        ],
        temperature: 0.3,
        user: request.safetyIdentifier,
      }),
    });
    if (!response.ok) throw new AIProviderUnavailableError(`OpenAI returned HTTP ${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const usage = {
      inputTokens: boundedTokens(payload.usage?.prompt_tokens),
      outputTokens: boundedTokens(payload.usage?.completion_tokens),
    };
    return {
      result: resultFor(request.action, content),
      provider: this.provider,
      model: this.model,
      usage,
      estimatedCostMicrousd: estimatedCostMicrousd(usage, this.pricing),
    };
  }
}

class AnthropicProvider implements AIProvider {
  readonly provider = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly pricing: AIModelPricing,
    private readonly fetchImplementation: FetchImplementation,
  ) {}

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const response = await this.fetchImplementation("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1_024,
        system: "أنت مساعد CalmBoard لإدارة العمل. أعد اقتراحات فقط ولا تدّع تنفيذ أي تغيير.",
        messages: [{ role: "user", content: promptFor(request) }],
      }),
    });
    if (!response.ok) throw new AIProviderUnavailableError(`Anthropic returned HTTP ${response.status}`);
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = payload.content?.find((entry) => entry.type === "text")?.text ?? "";
    const usage = {
      inputTokens: boundedTokens(payload.usage?.input_tokens),
      outputTokens: boundedTokens(payload.usage?.output_tokens),
    };
    return {
      result: resultFor(request.action, content),
      provider: this.provider,
      model: this.model,
      usage,
      estimatedCostMicrousd: estimatedCostMicrousd(usage, this.pricing),
    };
  }
}

class FallbackAIProvider implements AIProvider {
  readonly provider = "fallback";

  constructor(private readonly providers: AIProvider[]) {}

  async generate(request: AIProviderRequest) {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.generate(request);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `${provider.provider} failed`);
      }
    }
    throw new AIProviderUnavailableError(failures.join("; "));
  }
}

class UnavailableAIProvider implements AIProvider {
  readonly provider = "unavailable";

  async generate(): Promise<AIProviderResponse> {
    throw new AIProviderUnavailableError();
  }
}

class PrivacySafeAIProvider implements AIProvider {
  readonly provider: string;

  constructor(private readonly delegate: AIProvider) {
    this.provider = delegate.provider;
  }

  generate(request: AIProviderRequest) {
    return this.delegate.generate(sanitizeAIProviderRequest(request));
  }
}

export function createAIProvider(
  environment: AIProviderEnvironment = process.env,
  fetchImplementation: FetchImplementation = fetch,
): AIProvider {
  const providers: AIProvider[] = [];
  if (environment.OPENAI_API_KEY?.trim()) {
    const model = requiredModel("OpenAI", environment.OPENAI_MODEL);
    providers.push(
      new OpenAIProvider(
        environment.OPENAI_API_KEY.trim(),
        model,
        requiredModelPricing(environment, "openai", model),
        fetchImplementation,
      ),
    );
  }
  if (environment.ANTHROPIC_API_KEY?.trim()) {
    const model = requiredModel("Anthropic", environment.ANTHROPIC_MODEL);
    providers.push(
      new AnthropicProvider(
        environment.ANTHROPIC_API_KEY.trim(),
        model,
        requiredModelPricing(environment, "anthropic", model),
        fetchImplementation,
      ),
    );
  }
  if (!providers.length) return new UnavailableAIProvider();
  const provider = providers.length === 1 ? providers[0]! : new FallbackAIProvider(providers);
  return new PrivacySafeAIProvider(provider);
}
