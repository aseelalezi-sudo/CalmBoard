import assert from "node:assert/strict";
import test from "node:test";
import { submitPublicForm } from "./public-api";

test("public form submission sends answers and CAPTCHA proof in a bounded envelope", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ responseId: "response-1", taskCreationStatus: "pending" });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await submitPublicForm("form/a", { title: "Request", hidden: "" }, "captcha-token");
  assert.deepEqual(result, { responseId: "response-1", taskCreationStatus: "pending" });
  assert.match(request?.url ?? "", /forms\/form%2Fa\/submit$/);
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    values: { title: "Request", hidden: "" },
    captchaToken: "captcha-token",
  });
});
