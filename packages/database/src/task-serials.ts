import { sql } from "drizzle-orm";
import { db } from "./client.js";
import { tasks, taskSerialSequences } from "./schema.js";

export const FIRST_TASK_SERIAL_NUMBER = 1041;

export async function allocateTaskSerialNumbers(organizationId: string, amount = 1): Promise<number[]> {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new RangeError("Task serial allocation amount must be a positive safe integer");
  }

  const [sequence] = await db
    .insert(taskSerialSequences)
    .values({
      organizationId,
      nextValue: FIRST_TASK_SERIAL_NUMBER + amount,
    })
    .onConflictDoUpdate({
      target: taskSerialSequences.organizationId,
      set: {
        nextValue: sql`${taskSerialSequences.nextValue} + ${amount}`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextValue: taskSerialSequences.nextValue });

  if (!sequence) {
    throw new Error("Task serial allocation did not return a sequence value");
  }

  const firstValue = sequence.nextValue - amount;
  return Array.from({ length: amount }, (_, index) => firstValue + index);
}

export async function synchronizeTaskSerialSequence(organizationId: string): Promise<number> {
  const nextValue = sql<number>`greatest(
    ${FIRST_TASK_SERIAL_NUMBER},
    coalesce(
      (
        select max(substring(${tasks.serial} from 6)::integer) + 1
        from ${tasks}
        where ${tasks.organizationId} = ${organizationId}
          and ${tasks.serial} ~ '^TASK-[0-9]+$'
      ),
      ${FIRST_TASK_SERIAL_NUMBER}
    )
  )`;
  const [sequence] = await db
    .insert(taskSerialSequences)
    .values({ organizationId, nextValue })
    .onConflictDoUpdate({
      target: taskSerialSequences.organizationId,
      set: {
        nextValue: sql`greatest(${taskSerialSequences.nextValue}, excluded.next_value)`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextValue: taskSerialSequences.nextValue });

  if (!sequence) {
    throw new Error("Task serial synchronization did not return a sequence value");
  }
  return sequence.nextValue;
}

export function formatTaskSerial(value: number) {
  return `TASK-${value}`;
}
