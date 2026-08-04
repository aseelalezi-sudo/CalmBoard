import http from "k6/http";
import { check, fail, sleep } from "k6";

const apiBaseUrl = (__ENV.API_BASE_URL || "http://127.0.0.1:5500").replace(/\/$/, "");
const organizationId = __ENV.ORGANIZATION_ID;
const workspaceId = __ENV.WORKSPACE_ID;
const accessToken = __ENV.AUTH_ACCESS_TOKEN;
const datasetTaskCount = Number(__ENV.DATASET_TASK_COUNT || 0);

export const options = {
  stages: [
    { duration: "30s", target: 25 },
    { duration: "1m", target: 50 },
    { duration: "3m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:health}": ["p(95)<250"],
    "http_req_duration{endpoint:tasks}": ["p(95)<750", "p(99)<1500"],
  },
};

export function setup() {
  if (!organizationId || !workspaceId || !accessToken) {
    fail("ORGANIZATION_ID, WORKSPACE_ID, and AUTH_ACCESS_TOKEN are required");
  }
  if (!Number.isInteger(datasetTaskCount) || datasetTaskCount < 100000) {
    fail("DATASET_TASK_COUNT must record a prepared workspace containing at least 100000 tasks");
  }

  const readiness = http.get(`${apiBaseUrl}/health/readiness`, { tags: { endpoint: "health" } });
  if (!check(readiness, { "staging API is ready": (response) => response.status === 200 })) {
    fail(`API readiness failed with status ${readiness.status}`);
  }
}

export default function () {
  const headers = {
    Cookie: `calmboard_access=${accessToken}`,
    "x-correlation-id": `k6-${__VU}-${__ITER}`,
  };
  const query =
    `organizationId=${encodeURIComponent(organizationId)}` +
    `&workspaceId=${encodeURIComponent(workspaceId)}` +
    "&limit=100&sortBy=updatedAt&sortDirection=desc";

  const responses = http.batch([
    ["GET", `${apiBaseUrl}/health/readiness`, null, { tags: { endpoint: "health" } }],
    ["GET", `${apiBaseUrl}/tasks?${query}`, null, { headers, tags: { endpoint: "tasks" } }],
  ]);

  check(responses[0], {
    "readiness is 200": (response) => response.status === 200,
  });
  check(responses[1], {
    "task page is 200": (response) => response.status === 200,
    "task page is JSON": (response) => (response.headers["Content-Type"] || "").includes("application/json"),
    "correlation ID is returned": (response) => Boolean(response.headers["X-Correlation-Id"]),
  });

  sleep(1);
}
