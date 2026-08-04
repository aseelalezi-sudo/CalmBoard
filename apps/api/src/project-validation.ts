import { BadRequestException } from "@nestjs/common";
import { z } from "@calmboard/validation";
import type { CreateProjectInput, DatabaseTenantContext } from "@calmboard/database";
import type { JsonObject } from "./request-validation.js";

const emptyToNull = (value: unknown) => (value === "" ? null : value);
const nullableString = (maximum: number) =>
  z.preprocess(emptyToNull, z.string().trim().min(1).max(maximum).nullable()).optional();
const nullableDate = z
  .preprocess(emptyToNull, z.union([z.iso.datetime({ offset: true }), z.date()]).nullable())
  .optional();
const nullableNonnegativeNumber = z.preprocess(emptyToNull, z.number().finite().nonnegative().nullable()).optional();

const createProjectSchema = z
  .object({
    organizationId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    actorId: nullableString(255),
    name: z.string().trim().min(1).max(255),
    description: z.string().max(100_000).nullable().optional(),
    color: z.string().trim().min(1).max(20).optional(),
    icon: z.string().trim().min(1).max(30).optional(),
    coverUrl: nullableString(4_096),
    status: z.enum(["planning", "active", "on_hold", "completed", "archived"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    ownerId: nullableString(255),
    managerId: nullableString(255),
    memberIds: z.array(z.string().trim().min(1)).max(1_000).optional(),
    teamIds: z.array(z.string().trim().min(1)).max(1_000).optional(),
    startDate: nullableDate,
    endDate: nullableDate,
    privacy: z.enum(["workspace", "private", "private-members", "guest-share", "archived"]).optional(),
    template: z.enum(["default", "scrum", "marketing", "roadmap", "bugs"]).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    budget: nullableNonnegativeNumber,
    estimatedHours: nullableNonnegativeNumber,
    loggedHours: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) => {
      if (!value.startDate || !value.endDate) return true;
      return new Date(value.endDate).getTime() >= new Date(value.startDate).getTime();
    },
    { message: "endDate must be on or after startDate", path: ["endDate"] },
  );

function parseBody(body: JsonObject) {
  const result = createProjectSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")} ` : "";
    throw new BadRequestException(`${field}${issue?.message ?? "is invalid"}`.trim());
  }
  return result.data;
}

function toDate(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return value;
  return typeof value === "string" ? new Date(value) : new Date(value.getTime());
}

export function parseCreateProjectRequest(body: JsonObject): {
  context: DatabaseTenantContext;
  input: CreateProjectInput;
} {
  const value = parseBody(body);
  return {
    context: {
      organizationId: value.organizationId,
      workspaceId: value.workspaceId,
      actorId: value.actorId ?? value.ownerId ?? undefined,
    },
    input: {
      name: value.name,
      description: value.description,
      color: value.color,
      icon: value.icon,
      coverUrl: value.coverUrl,
      status: value.status,
      priority: value.priority,
      ownerId: value.ownerId,
      managerId: value.managerId,
      memberIds: value.memberIds,
      teamIds: value.teamIds,
      startDate: toDate(value.startDate),
      endDate: toDate(value.endDate),
      privacy: value.privacy,
      template: value.template,
      progress: value.progress,
      budget: value.budget,
      estimatedHours: value.estimatedHours,
      loggedHours: value.loggedHours,
    },
  };
}
