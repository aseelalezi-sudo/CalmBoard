import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

export type AdminJob = {
  id: string;
  queue: string;
  name: string;
  status: "active" | "completed" | "failed" | "delayed";
  attempts: number;
  durationMs?: number;
  error?: string;
  createdAt: string;
};

export type QueueSnapshot = {
  jobs: AdminJob[];
  counts: {
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  };
  redis: { available: boolean; error?: string };
  durableDeadLetters: number;
};

export type SecurityTestResult = {
  id: string;
  name_ar: string;
  name_en: string;
  category: string;
  status: "passed" | "failed";
  latencyMs: number;
  details_ar: string;
  details_en: string;
};

export type SecurityTestReport = {
  summary: {
    passed: number;
    total: number;
    durationMs: number;
    timestamp: string;
  };
  tests: SecurityTestResult[];
};

export function getQueueSnapshot() {
  return requestJson<QueueSnapshot>(apiServiceUrl("/admin/queues"));
}

export async function runQueueAction(action: string, jobId?: string) {
  await request(apiServiceUrl("/admin/queues"), jsonRequest("POST", { action, jobId }));
}

export function runSecurityTests() {
  return requestJson<SecurityTestReport>(apiServiceUrl("/admin/security-tests"));
}
