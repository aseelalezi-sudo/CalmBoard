import { expect, test } from "@playwright/test";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

test("collaboration HTTP responses omit password and account security fields", async ({ page }) => {
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const query = new URLSearchParams(scope).toString();
  const project = await api(page, "/projects", "POST", { ...scope, name: "Public user projection" });
  expect(project.status).toBe(201);
  const task = await api(page, "/tasks", "POST", {
    ...scope,
    projectId: (project.data as { id: string }).id,
    title: "Assigned task",
    assigneeIds: [owner.userId],
  });
  expect(task.status).toBe(201);
  const taskId = (task.data as { id: string }).id;
  const comment = await api(page, "/comments", "POST", {
    ...scope,
    taskId,
    userId: owner.userId,
    content: "Public comment",
  });
  expect(comment.status, JSON.stringify(comment.data)).toBe(201);
  const skills = await api(page, "/users/skills", "POST", { ...scope, userId: owner.userId, skills: ["testing"] });
  expect(skills.status).toBe(201);
  expect(skills.data).toMatchObject({ id: owner.userId, skills: ["testing"] });
  const responses = [task, comment, skills];
  for (const path of ["tasks", "members", "activities", `comments?taskId=${taskId}`]) {
    const response = await api(page, `/${path}${path.includes("?") ? "&" : "?"}${query}`);
    expect(response.status).toBe(200);
    responses.push(response);
  }
  expect(task.data).toMatchObject({ assignee: { id: owner.userId } });
  expect(responses.at(-1)?.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user: {
          id: owner.userId,
          name: expect.any(String),
          email: expect.any(String),
          avatarUrl: null,
          locale: expect.any(String),
          skills: ["testing"],
        },
      }),
    ]),
  );
  for (const response of responses) {
    expect(JSON.stringify(response.data)).not.toMatch(
      /"(?:passwordHash|passwordChangedAt|failedLoginAttempts|lockedUntil|lastFailedLoginAt|lastLoginAt|isPlatformAdmin|authDisabledAt|anonymizedAt)"\s*:/,
    );
  }
});
