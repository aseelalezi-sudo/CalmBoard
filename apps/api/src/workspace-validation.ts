import { BadRequestException } from "@nestjs/common";
import type { UpdateWorkspaceInput } from "@calmboard/database";
import { requiredString, type JsonObject } from "./request-validation.js";

function optionalText(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string or null`);
  return value.trim();
}

export function parseUpdateWorkspaceInput(body: JsonObject): UpdateWorkspaceInput {
  const input: UpdateWorkspaceInput = {};
  if (body.name !== undefined) input.name = requiredString(body.name, "name");
  if (body.slug !== undefined) input.slug = requiredString(body.slug, "slug").toLowerCase().replace(/\s+/g, "-");
  if (body.color !== undefined) input.color = requiredString(body.color, "color");
  if (body.icon !== undefined) input.icon = requiredString(body.icon, "icon");
  if (body.description !== undefined) input.description = optionalText(body.description, "description");
  if (!Object.keys(input).length) throw new BadRequestException("at least one workspace field is required");
  return input;
}
