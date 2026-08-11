import { BadRequestException } from "@nestjs/common";

export function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return 10;
  const parsed = Number(value);
  if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new BadRequestException("limit must be an integer between 1 and 50");
  }
  return parsed;
}

export function parseTimezone(value: unknown): string {
  if (value === undefined || value === null || value === "") return "UTC";
  if (typeof value !== "string" || value.length > 100) {
    throw new BadRequestException("timezone is invalid");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch (error) {
    throw new BadRequestException("timezone must be a valid IANA time zone");
  }
  return value;
}
