import type { Pool, PoolClient } from "pg";

export const scheduledReportJobName = "reports.enqueue-scheduled";

export type ScheduledReportOptions = {
  batchSize: number;
};

export function readScheduledReportOptions(env: NodeJS.ProcessEnv = process.env): ScheduledReportOptions {
  const batchSize = Number(env.REPORT_SCHEDULE_BATCH_SIZE ?? 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new Error("REPORT_SCHEDULE_BATCH_SIZE must be an integer between 1 and 200");
  }
  return { batchSize };
}

type DueSchedule = {
  id: string;
  organization_id: string;
  workspace_id: string;
  created_by: string;
  format: "pdf" | "xlsx";
  cadence: "daily" | "weekly" | "monthly";
  timezone: string;
  minute_of_day: number;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: Date;
};

async function enqueueLockedSchedules(client: PoolClient, options: ScheduledReportOptions) {
  const due = await client.query<DueSchedule>(
    `select id, organization_id, workspace_id, created_by, format, cadence, timezone,
       minute_of_day, day_of_week, day_of_month, next_run_at
     from report_schedules
     where is_enabled = true
       and deleted_at is null
       and next_run_at <= now()
     order by next_run_at, id
     for update skip locked
     limit $1`,
    [options.batchSize],
  );
  let enqueued = 0;
  for (const schedule of due.rows) {
    const occurrence = new Date(schedule.next_run_at);
    const inserted = await client.query(
      `insert into export_jobs (
         organization_id, workspace_id, requested_by, report_schedule_id, scheduled_for,
         format, idempotency_key
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        schedule.organization_id,
        schedule.workspace_id,
        schedule.created_by,
        schedule.id,
        occurrence,
        schedule.format,
        `scheduled-report/${schedule.id}/${occurrence.toISOString()}`,
      ],
    );
    enqueued += inserted.rowCount ?? 0;
    await client.query(
      `update report_schedules
       set last_run_at = $2,
           next_run_at = public.next_report_run(cadence, timezone, minute_of_day, day_of_week, day_of_month, now()),
           updated_at = now()
       where id = $1`,
      [schedule.id, occurrence],
    );
  }
  return { claimed: due.rowCount ?? 0, enqueued };
}

export async function enqueueScheduledReports(
  pool: Pool,
  options: ScheduledReportOptions = readScheduledReportOptions(),
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await enqueueLockedSchedules(client, options);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
