import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIProviderUnavailableError, createAIProvider, type AIProviderRequest } from "./ai-provider.js";

const request: AIProviderRequest = {
  action: "priority",
  text: "إصلاح عطل يمنع تسجيل الدخول",
  tasks: [],
  safetyIdentifier: "privacy-safe-user-id",
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function pricing(...entries: Array<[string, number, number]>) {
  return JSON.stringify(
    Object.fromEntries(
      entries.map(([key, inputUsdPerMillion, outputUsdPerMillion]) => [
        key,
        { inputUsdPerMillion, outputUsdPerMillion },
      ]),
    ),
  );
}

describe("AI provider abstraction", () => {
  it("fails closed when no provider is configured", async () => {
    const provider = createAIProvider({}, async () => assert.fail("network must not be called"));
    assert.equal(provider.provider, "unavailable");
    await assert.rejects(() => provider.generate(request), AIProviderUnavailableError);
  });

  it("requires an explicit model for every configured provider", () => {
    assert.throws(() => createAIProvider({ OPENAI_API_KEY: "secret" }), /OpenAI model is not configured/);
    assert.throws(() => createAIProvider({ ANTHROPIC_API_KEY: "secret" }), /Anthropic model is not configured/);
  });

  it("fails closed when model pricing is missing or malformed", () => {
    assert.throws(
      () => createAIProvider({ OPENAI_API_KEY: "secret", OPENAI_MODEL: "openai-model" }),
      /Pricing is not configured/,
    );
    assert.throws(
      () =>
        createAIProvider({
          OPENAI_API_KEY: "secret",
          OPENAI_MODEL: "openai-model",
          AI_MODEL_PRICING_JSON: "not-json",
        }),
      /not valid JSON/,
    );
  });

  it("normalizes OpenAI output and reports provider usage", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const provider = createAIProvider(
      {
        OPENAI_API_KEY: "secret",
        OPENAI_MODEL: "configured-openai-model",
        AI_MODEL_PRICING_JSON: pricing(["openai:configured-openai-model", 2, 8]),
      },
      async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          choices: [{ message: { content: "urgent — لأنه يمنع الدخول" } }],
          usage: { prompt_tokens: 18, completion_tokens: 7 },
        });
      },
    );

    assert.deepEqual(await provider.generate(request), {
      result: { result: "urgent", reason: "urgent — لأنه يمنع الدخول" },
      provider: "openai",
      model: "configured-openai-model",
      usage: { inputTokens: 18, outputTokens: 7 },
      estimatedCostMicrousd: 92,
    });
    assert.equal(capturedBody?.model, "configured-openai-model");
    assert.equal(capturedBody?.user, request.safetyIdentifier);
  });

  it("removes sensitive values from the outgoing provider body", async () => {
    const outgoingBodies: string[] = [];
    const provider = createAIProvider(
      {
        OPENAI_API_KEY: "secret",
        OPENAI_MODEL: "configured-openai-model",
        AI_MODEL_PRICING_JSON: pricing(["openai:configured-openai-model", 2, 8]),
      },
      async (_url, init) => {
        outgoingBodies.push(String(init?.body));
        return jsonResponse({
          choices: [{ message: { content: "تمت المعالجة" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        });
      },
    );

    await provider.generate({
      action: "translate",
      text: "password=secret-value and owner@example.com",
      tasks: [],
      safetyIdentifier: "privacy-safe-user-id",
    });
    await provider.generate({
      action: "summarize",
      text: "",
      tasks: [
        {
          serial: "PRIVATE-19",
          title: "Call +966 50 123 4567 using sk-ant-abcdefghijklmnopqrstuvwxyz123456",
          status: "todo",
          priority: "high",
          progress: 0,
          dueDate: null,
        },
      ],
      safetyIdentifier: "privacy-safe-user-id",
    });
    const outgoing = outgoingBodies.join("\n");

    for (const sensitive of [
      "secret-value",
      "owner@example.com",
      "+966 50 123 4567",
      "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
      "PRIVATE-19",
    ]) {
      assert.equal(outgoing.includes(sensitive), false);
    }
    assert.match(outgoing, /\[EMAIL_1\]/);
    assert.match(outgoing, /\[TASK_REFERENCE_1\]/);
  });

  it("falls back to Anthropic without returning fabricated output", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const provider = createAIProvider(
      {
        OPENAI_API_KEY: "openai-secret",
        OPENAI_MODEL: "openai-model",
        ANTHROPIC_API_KEY: "anthropic-secret",
        ANTHROPIC_MODEL: "anthropic-model",
        AI_MODEL_PRICING_JSON: pricing(["openai:openai-model", 2, 8], ["anthropic:anthropic-model", 3, 15]),
      },
      async (url, init) => {
        calls.push(String(url));
        bodies.push(String(init?.body));
        if (String(url).includes("openai.com")) return jsonResponse({}, 503);
        return jsonResponse({ content: [{ type: "text", text: "high — تأثير مرتفع" }], usage: {} });
      },
    );

    const response = await provider.generate({
      ...request,
      text: "Contact fallback@example.com with password=fallback-secret",
    });
    assert.equal(response.provider, "anthropic");
    assert.deepEqual(response.result, { result: "high", reason: "high — تأثير مرتفع" });
    assert.equal(calls.length, 2);
    assert.ok(bodies.every((body) => !body.includes("fallback@example.com") && !body.includes("fallback-secret")));
    assert.ok(bodies.every((body) => body.includes("[EMAIL_1]") && body.includes("[SECRET_1]")));
  });
});
