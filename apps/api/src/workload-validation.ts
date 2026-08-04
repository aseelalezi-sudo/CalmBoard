import { BadRequestException } from "@nestjs/common";
import type { CreateWorkloadTimeOffInput, UpsertWorkloadCapacityInput, WorkloadTimeOffKind } from "@calmboard/database";
import { optionalString, requiredString, type JsonObject } from "./request-validation.js";

const timeOffKinds = new Set<WorkloadTimeOffKind>(["vacation", "sick", "personal", "public_holiday"]);

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new BadRequestException(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseIsoDate(value: unknown, field: string) {
  const parsed = requiredString(value, field);
  const date = new Date(`${parsed}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== parsed
  ) {
    throw new BadRequestException(`${field} must be an ISO calendar date`);
  }
  return parsed;
}

export function parseWorkloadRange(rangeStart: unknown, rangeEnd: unknown) {
  if (rangeStart === undefined && rangeEnd === undefined) return {};
  const start = parseIsoDate(rangeStart, "rangeStart");
  const end = parseIsoDate(rangeEnd, "rangeEnd");
  if (end < start) throw new BadRequestException("rangeEnd must not be before rangeStart");
  return { rangeStart: start, rangeEnd: end };
}

export function parseWorkloadCapacityInput(body: JsonObject, userId: string): UpsertWorkloadCapacityInput {
  return {
    userId: requiredString(userId, "userId"),
    weeklyMinutes: boundedInteger(body.weeklyMinutes, "weeklyMinutes", 0, 10080),
    workdayMask: boundedInteger(body.workdayMask, "workdayMask", 0, 127),
  };
}

export function parseWorkloadTimeOffInput(body: JsonObject): CreateWorkloadTimeOffInput {
  const kind = requiredString(body.kind, "kind") as WorkloadTimeOffKind;
  if (!timeOffKinds.has(kind)) throw new BadRequestException("kind is invalid");
  const startsOn = parseIsoDate(body.startsOn, "startsOn");
  const endsOn = parseIsoDate(body.endsOn, "endsOn");
  if (endsOn < startsOn) throw new BadRequestException("endsOn must not be before startsOn");
  const note = optionalString(body.note, "note");
  if (note && note.length > 500) throw new BadRequestException("note is too long");
  return {
    userId: optionalString(body.userId, "userId") ?? null,
    kind,
    startsOn,
    endsOn,
    minutesPerDay:
      body.minutesPerDay === undefined || body.minutesPerDay === null
        ? null
        : boundedInteger(body.minutesPerDay, "minutesPerDay", 1, 1440),
    note,
  };
}
