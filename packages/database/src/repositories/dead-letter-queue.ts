import { sql } from "drizzle-orm";
import { db } from "../client.js";

export const deadLetterSources = [
  "notification_email",
  "auth_email",
  "automation_event",
  "workspace_export",
  "form_task_creation",
] as const;

export type DeadLetterSource = (typeof deadLetterSources)[number];

type DeadLetterRow = {
  source: DeadLetterSource;
  source_id: string;
  organization_id: string | null;
  workspace_id: string | null;
  queue: string;
  job_name: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  failed_at: Date | string;
};

function isDeadLetterSource(value: string): value is DeadLetterSource {
  return deadLetterSources.some((source) => source === value);
}

export function createDeadLetterQueueRepository() {
  return {
    async list(limit = 100) {
      const result = await db.execute<DeadLetterRow>(
        sql`select * from public.list_dead_letters(${Math.min(Math.max(limit, 1), 500)})`,
      );
      return result.rows.map((row) => ({
        source: row.source,
        sourceId: row.source_id,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        queue: row.queue,
        jobName: row.job_name,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        error: row.error,
        failedAt: row.failed_at instanceof Date ? row.failed_at.toISOString() : new Date(row.failed_at).toISOString(),
      }));
    },

    async retry(source: string, sourceId: string) {
      if (!isDeadLetterSource(source)) return false;
      const result = await db.execute<{ retried: boolean }>(
        sql`select public.retry_dead_letter(${source}, ${sourceId}::uuid) as retried`,
      );
      return result.rows[0]?.retried === true;
    },

    async retryAll() {
      const result = await db.execute<{ retried: number }>(sql`select public.retry_all_dead_letters()::int as retried`);
      return result.rows[0]?.retried ?? 0;
    },
  };
}
