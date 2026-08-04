import { BadRequestException } from "@nestjs/common";
import type { CreateTaskApprovalInput, TaskApprovalDecision, TaskChecklistInput } from "@calmboard/database";
import { isJsonObject, requiredString, type JsonObject } from "./request-validation.js";

const approvalModes = new Set<CreateTaskApprovalInput["mode"]>(["all", "any", "sequential"]);
const approvalDecisions = new Set<TaskApprovalDecision>(["approved", "rejected"]);

function optionalOrder(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return value;
}

export function parseTaskChecklists(value: unknown): TaskChecklistInput[] {
  if (!Array.isArray(value)) throw new BadRequestException("checklists must be an array");
  if (value.length > 20) throw new BadRequestException("checklists must not contain more than 20 entries");
  let itemCount = 0;
  return value.map((checklist, checklistIndex) => {
    if (!isJsonObject(checklist)) throw new BadRequestException(`checklists.${checklistIndex} must be an object`);
    const title = requiredString(checklist.title, `checklists.${checklistIndex}.title`);
    if (title.length > 255) throw new BadRequestException(`checklists.${checklistIndex}.title is too long`);
    if (checklist.items !== undefined && !Array.isArray(checklist.items)) {
      throw new BadRequestException(`checklists.${checklistIndex}.items must be an array`);
    }
    const items = (checklist.items ?? []).map((item: unknown, itemIndex: number) => {
      if (!isJsonObject(item)) {
        throw new BadRequestException(`checklists.${checklistIndex}.items.${itemIndex} must be an object`);
      }
      const itemTitle = requiredString(item.title, `checklists.${checklistIndex}.items.${itemIndex}.title`);
      if (itemTitle.length > 500) {
        throw new BadRequestException(`checklists.${checklistIndex}.items.${itemIndex}.title is too long`);
      }
      if (item.isCompleted !== undefined && typeof item.isCompleted !== "boolean") {
        throw new BadRequestException(`checklists.${checklistIndex}.items.${itemIndex}.isCompleted must be boolean`);
      }
      return {
        title: itemTitle,
        order: optionalOrder(item.order, `checklists.${checklistIndex}.items.${itemIndex}.order`),
        isCompleted: item.isCompleted as boolean | undefined,
      };
    });
    itemCount += items.length;
    if (itemCount > 200) throw new BadRequestException("checklists must not contain more than 200 items");
    return {
      title,
      order: optionalOrder(checklist.order, `checklists.${checklistIndex}.order`),
      items,
    };
  });
}

export function parseTaskApprovalRequest(taskId: string, body: JsonObject): CreateTaskApprovalInput {
  if (!Array.isArray(body.reviewerIds) || !body.reviewerIds.length || body.reviewerIds.length > 20) {
    throw new BadRequestException("reviewerIds must contain between 1 and 20 users");
  }
  const reviewerIds = body.reviewerIds.map((reviewerId, index) => requiredString(reviewerId, `reviewerIds.${index}`));
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    throw new BadRequestException("reviewerIds must be unique");
  }
  if (body.mode !== undefined && (typeof body.mode !== "string" || !approvalModes.has(body.mode as never))) {
    throw new BadRequestException("mode is invalid");
  }
  let dueAt: Date | null | undefined;
  if (body.dueAt === null || body.dueAt === "") {
    dueAt = null;
  } else if (body.dueAt !== undefined) {
    dueAt = new Date(requiredString(body.dueAt, "dueAt"));
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException("dueAt must be a valid date");
  }
  if (body.message !== undefined && body.message !== null && typeof body.message !== "string") {
    throw new BadRequestException("message must be a string or null");
  }
  return {
    taskId,
    reviewerIds,
    mode: body.mode as CreateTaskApprovalInput["mode"],
    message: body.message as string | null | undefined,
    dueAt,
  };
}

export function parseTaskApprovalDecision(body: JsonObject) {
  if (typeof body.decision !== "string" || !approvalDecisions.has(body.decision as TaskApprovalDecision)) {
    throw new BadRequestException("decision must be approved or rejected");
  }
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") {
    throw new BadRequestException("comment must be a string or null");
  }
  return {
    decision: body.decision as TaskApprovalDecision,
    comment: body.comment as string | null | undefined,
  };
}
