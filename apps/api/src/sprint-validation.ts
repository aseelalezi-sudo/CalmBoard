import { BadRequestException } from "@nestjs/common";
import { z } from "@calmboard/validation";
import type { SprintStatus } from "@calmboard/database";
import { requiredString, isJsonObject, type JsonObject } from "./request-validation.js";

const sprintStatuses = new Set<SprintStatus>(["planned", "active", "completed", "cancelled"]);

export function parseSprintStatus(value: unknown, field = "status"): SprintStatus {
  if (typeof value !== "string" || !sprintStatuses.has(value as SprintStatus)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value as SprintStatus;
}

export function parseCreateSprintInput(body: unknown) {
  if (!isJsonObject(body)) {
    throw new BadRequestException("Request body must be a JSON object");
  }

  const name = requiredString(body.name, "name");
  const goal = typeof body.goal === "string" ? body.goal : undefined;

  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : undefined;
  const endsAt = typeof body.endsAt === "string" ? new Date(body.endsAt) : undefined;

  if (startsAt && isNaN(startsAt.getTime())) throw new BadRequestException("startsAt is invalid date");
  if (endsAt && isNaN(endsAt.getTime())) throw new BadRequestException("endsAt is invalid date");

  if (startsAt && endsAt && startsAt > endsAt) {
    throw new BadRequestException("startsAt must be before endsAt");
  }

  return { name, goal, startsAt, endsAt };
}

export function parseUpdateSprintInput(body: unknown) {
  if (!isJsonObject(body)) {
    throw new BadRequestException("Request body must be a JSON object");
  }

  const updates: Record<string, any> = {};

  if ("name" in body) updates.name = requiredString(body.name, "name");
  if ("goal" in body) updates.goal = typeof body.goal === "string" ? body.goal : null;
  if ("startsAt" in body) updates.startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  if ("endsAt" in body) updates.endsAt = typeof body.endsAt === "string" ? new Date(body.endsAt) : null;

  if (updates.startsAt && isNaN(updates.startsAt.getTime())) throw new BadRequestException("startsAt is invalid date");
  if (updates.endsAt && isNaN(updates.endsAt.getTime())) throw new BadRequestException("endsAt is invalid date");

  // Prevent generic updates to lifecycle fields
  const forbiddenFields = [
    "status",
    "startedAt",
    "completedAt",
    "cancelledAt",
    "deletedAt",
    "createdBy",
    "organizationId",
    "workspaceId",
    "projectId",
  ];
  for (const field of forbiddenFields) {
    if (field in body) {
      throw new BadRequestException(`Field ${field} cannot be modified via generic update`);
    }
  }

  return updates;
}

export function parseCompleteSprintInput(body: unknown): { type: "backlog" } | { type: "sprint"; sprintId: string } {
  if (!isJsonObject(body)) throw new BadRequestException("Request body must be a JSON object");

  const dest = body.incompleteTaskDestination;
  if (!isJsonObject(dest)) throw new BadRequestException("incompleteTaskDestination must be provided as an object");

  if (dest.type === "backlog") return { type: "backlog" };
  if (dest.type === "sprint") {
    const sprintId = requiredString(dest.sprintId, "incompleteTaskDestination.sprintId");
    return { type: "sprint", sprintId };
  }
  throw new BadRequestException("incompleteTaskDestination.type must be 'backlog' or 'sprint'");
}

export function parseMoveTaskSprintInput(body: unknown) {
  if (!isJsonObject(body)) throw new BadRequestException("Request body must be a JSON object");

  const targetSprintId = typeof body.targetSprintId === "string" ? body.targetSprintId : null;
  const expectedFromSprintId =
    body.expectedFromSprintId === null
      ? null
      : typeof body.expectedFromSprintId === "string"
        ? body.expectedFromSprintId
        : undefined;

  return { targetSprintId, expectedFromSprintId };
}
