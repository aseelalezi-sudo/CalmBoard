import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CommentsController } from "./comments.controller.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

test("bulk reaction replacement is rejected before repository access", async () => {
  const controller = new CommentsController();
  for (const field of ["reactions", "reactionUserIds"]) {
    await assert.rejects(
      controller.update({ id: "comment", [field]: { "👍": ["forged-user"] } }, "valid-key-123"),
      BadRequestException,
    );
  }
});

test("reaction commands require authentication, a supported emoji and an explicit boolean", async () => {
  const controller = new CommentsController();
  await assert.rejects(
    controller.setReaction({ id: "comment", emoji: "👍", active: true }, {} as AuthenticatedRequest, "valid-key-123"),
    ForbiddenException,
  );
  const request = { auth: { userId: "actor", sessionId: "session" } } as AuthenticatedRequest;
  for (const body of [{ emoji: "unknown", active: true }, { emoji: "👍", active: "true" }, { emoji: "👍" }]) {
    await assert.rejects(
      controller.setReaction({ id: "comment", ...body }, request, "valid-key-123"),
      BadRequestException,
    );
  }
});
