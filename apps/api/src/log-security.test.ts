import assert from "node:assert/strict";
import test from "node:test";
import { serializeLogRequest, serializeLogResponse } from "./log-security.js";

test("HTTP log serializers exclude credentials, tokens, query values, and response cookies", () => {
  const request = serializeLogRequest({
    id: "request-1",
    method: "POST",
    url: "/invitations/accept?token=invite-secret",
    remoteAddress: "127.0.0.1",
    headers: {
      authorization: "Bearer access-secret",
      cookie: "calmboard_access=cookie-secret",
      "x-csrf-token": "csrf-secret",
    },
  } as Parameters<typeof serializeLogRequest>[0] & { headers: Record<string, string> });
  const response = serializeLogResponse({
    statusCode: 201,
    headers: { "set-cookie": "calmboard_access=response-secret" },
  } as Parameters<typeof serializeLogResponse>[0] & { headers: Record<string, string> });
  const output = JSON.stringify({ request, response });

  assert.deepEqual(request, {
    id: "request-1",
    method: "POST",
    url: "/invitations/accept",
    remoteAddress: "127.0.0.1",
  });
  assert.deepEqual(response, { statusCode: 201 });
  assert.doesNotMatch(output, /invite-secret|access-secret|cookie-secret|csrf-secret|response-secret/);
});
