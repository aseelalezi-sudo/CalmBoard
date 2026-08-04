import type { Pool, PoolClient } from "pg";

export const taskReminderJobName = "tasks.dispatch-reminders";

export type TaskReminderOptions = {
  batchSize: number;
};

type DueTaskReminder = {
  id: string;
  organization_id: string;
  workspace_id: string;
  task_id: string;
  label: string;
  task_title: string;
  task_serial: string;
};

export function readTaskReminderOptions(env: NodeJS.ProcessEnv = process.env): TaskReminderOptions {
  const batchSize = Number(env.TASK_REMINDER_BATCH_SIZE ?? 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("TASK_REMINDER_BATCH_SIZE must be an integer between 1 and 1000");
  }
  return { batchSize };
}

async function loadDueReminders(client: PoolClient, batchSize: number) {
  const result = await client.query<DueTaskReminder>(
    `select reminder.id,
            reminder.organization_id,
            reminder.workspace_id,
            reminder.task_id,
            reminder.label,
            task.title as task_title,
            task.serial as task_serial
     from task_reminders reminder
     join tasks task
       on task.id = reminder.task_id
      and task.organization_id = reminder.organization_id
      and task.workspace_id = reminder.workspace_id
     where reminder.status = 'scheduled'
       and reminder.remind_at <= now()
       and reminder.deleted_at is null
       and task.deleted_at is null
     order by reminder.remind_at, reminder.id
     for update of reminder skip locked
     limit $1`,
    [batchSize],
  );
  return result.rows;
}

async function createReminderNotifications(client: PoolClient, reminder: DueTaskReminder) {
  const result = await client.query<{ user_id: string }>(
    `with recipient_candidates as (
       select reminder.created_by as user_id
       from task_reminders reminder
       where reminder.id = $1 and reminder.created_by is not null

       union

       select assignee.user_id
       from task_reminders reminder
       join task_assignees assignee
         on assignee.task_id = reminder.task_id
        and assignee.organization_id = reminder.organization_id
        and assignee.workspace_id = reminder.workspace_id
        and assignee.unassigned_at is null
       where reminder.id = $1 and reminder.created_by is null

       union

       select follower.user_id
       from task_reminders reminder
       join task_followers follower
         on follower.task_id = reminder.task_id
        and follower.organization_id = reminder.organization_id
        and follower.workspace_id = reminder.workspace_id
        and follower.unfollowed_at is null
       where reminder.id = $1 and reminder.created_by is null

       union

       select coalesce(task.assignee_id, task.reporter_id)
       from task_reminders reminder
       join tasks task
         on task.id = reminder.task_id
        and task.organization_id = reminder.organization_id
        and task.workspace_id = reminder.workspace_id
       where reminder.id = $1
         and reminder.created_by is null
         and coalesce(task.assignee_id, task.reporter_id) is not null
     ), eligible_recipients as (
       select distinct candidate.user_id
       from recipient_candidates candidate
       where exists (
         select 1
         from memberships membership
         where membership.user_id = candidate.user_id
           and membership.organization_id = $2
           and (membership.workspace_id = $3 or membership.workspace_id is null)
           and membership.status = 'active'
       )
     )
     insert into notifications (
       organization_id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read
     )
     select $2,
            $3,
            recipient.user_id,
            'task_reminder',
            $4,
            $5,
            'task_reminder',
            $1,
            false
     from eligible_recipients recipient
     returning user_id`,
    [
      reminder.id,
      reminder.organization_id,
      reminder.workspace_id,
      reminder.label,
      `${reminder.task_serial}: ${reminder.task_title}`,
    ],
  );
  return result.rowCount ?? result.rows.length;
}

async function completeReminder(client: PoolClient, reminderId: string, delivered: number) {
  if (delivered > 0) {
    await client.query(
      `update task_reminders
       set status = 'sent', sent_at = now(), failure_reason = null, updated_at = now()
       where id = $1 and status = 'scheduled'`,
      [reminderId],
    );
    return "sent" as const;
  }

  await client.query(
    `update task_reminders
     set status = 'failed', failure_reason = 'No active reminder recipient', updated_at = now()
     where id = $1 and status = 'scheduled'`,
    [reminderId],
  );
  return "failed" as const;
}

export async function dispatchDueTaskReminders(pool: Pool, options: TaskReminderOptions = readTaskReminderOptions()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const reminders = await loadDueReminders(client, options.batchSize);
    let sent = 0;
    let failed = 0;
    let notifications = 0;

    for (const reminder of reminders) {
      const delivered = await createReminderNotifications(client, reminder);
      notifications += delivered;
      const status = await completeReminder(client, reminder.id, delivered);
      if (status === "sent") sent += 1;
      else failed += 1;
    }

    await client.query("commit");
    return { claimed: reminders.length, sent, failed, notifications };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
