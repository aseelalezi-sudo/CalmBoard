import { BadRequestException } from "@nestjs/common";
import type { ReportScheduleInput } from "@calmboard/database";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseReportScheduleInput(body: Record<string, unknown>): ReportScheduleInput {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
    throw new BadRequestException("name must contain between 1 and 120 characters");
  }
  if (body.format !== "pdf" && body.format !== "xlsx") {
    throw new BadRequestException("format must be pdf or xlsx");
  }
  if (body.cadence !== "daily" && body.cadence !== "weekly" && body.cadence !== "monthly") {
    throw new BadRequestException("cadence must be daily, weekly, or monthly");
  }
  if (typeof body.timezone !== "string" || !body.timezone || body.timezone.length > 100) {
    throw new BadRequestException("timezone is required");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format(new Date());
  } catch {
    throw new BadRequestException("timezone must be a valid IANA time zone");
  }
  if (typeof body.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
    throw new BadRequestException("time must use HH:mm");
  }
  const [hour, minute] = body.time.split(":").map(Number);
  const dayOfWeek = body.cadence === "weekly" ? Number(body.dayOfWeek) : null;
  const dayOfMonth = body.cadence === "monthly" ? Number(body.dayOfMonth) : null;
  if (body.cadence === "weekly" && (!Number.isInteger(dayOfWeek) || dayOfWeek! < 0 || dayOfWeek! > 6)) {
    throw new BadRequestException("dayOfWeek must be between 0 and 6 for weekly reports");
  }
  if (body.cadence === "monthly" && (!Number.isInteger(dayOfMonth) || dayOfMonth! < 1 || dayOfMonth! > 28)) {
    throw new BadRequestException("dayOfMonth must be between 1 and 28 for monthly reports");
  }
  if (!Array.isArray(body.recipientIds) || body.recipientIds.length < 1 || body.recipientIds.length > 50) {
    throw new BadRequestException("recipientIds must contain between 1 and 50 users");
  }
  const recipientIds = body.recipientIds.map((value) => {
    if (typeof value !== "string" || !uuidPattern.test(value)) {
      throw new BadRequestException("recipientIds must contain valid user ids");
    }
    return value;
  });
  if (new Set(recipientIds).size !== recipientIds.length) {
    throw new BadRequestException("recipientIds must not contain duplicates");
  }
  if (body.isEnabled !== undefined && typeof body.isEnabled !== "boolean") {
    throw new BadRequestException("isEnabled must be a boolean");
  }
  return {
    name: body.name.trim(),
    format: body.format,
    cadence: body.cadence,
    timezone: body.timezone,
    minuteOfDay: hour! * 60 + minute!,
    dayOfWeek,
    dayOfMonth,
    recipientIds,
    isEnabled: body.isEnabled !== false,
  };
}

export function parseExpectedReportScheduleVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException("expectedVersion must be a positive integer");
  }
  return version;
}
