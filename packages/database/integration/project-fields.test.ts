import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createProjectsRepository,
  db,
  memberships,
  organizations,
  pool,
  projectMembers,
  projects,
  projectSections,
  projectTeams,
  tasks,
  teams,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("complete project fields", () => {
  it("creates project fields, participants, teams, and template sections atomically", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const managerId = randomUUID();
    const memberId = randomUUID();
    const teamId = randomUUID();
    let projectId: string | undefined;

    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.test`, name: "Owner" },
        { id: managerId, email: `${managerId}@example.test`, name: "Manager" },
        { id: memberId, email: `${memberId}@example.test`, name: "Member" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Project fields tenant",
        slug: `project-fields-${organizationId}`,
        ownerId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Project fields workspace",
        slug: `project-fields-${workspaceId}`,
      });
      await db.insert(memberships).values(
        [ownerId, managerId, memberId].map((userId) => ({
          organizationId,
          workspaceId,
          userId,
          status: "active",
        })),
      );
      await db.insert(teams).values({
        id: teamId,
        organizationId,
        workspaceId,
        name: "Launch team",
      });

      const project = await createProjectsRepository({ organizationId, workspaceId, actorId: ownerId }).create({
        name: "Launch",
        ownerId,
        managerId,
        memberIds: [memberId],
        teamIds: [teamId],
        coverUrl: "https://example.test/cover.png",
        template: "roadmap",
        privacy: "private-members",
        progress: 25,
        budget: 10_000,
        estimatedHours: 200,
        loggedHours: 12,
      });
      projectId = project.id;
      assert.equal(project.managerId, managerId);
      assert.equal(project.template, "roadmap");
      assert.equal(project.privacy, "private-members");
      assert.equal(project.version, 1);

      const [memberRows, teamRows, sectionRows] = await Promise.all([
        db
          .select()
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, project.id), isNull(projectMembers.deletedAt))),
        db
          .select()
          .from(projectTeams)
          .where(and(eq(projectTeams.projectId, project.id), isNull(projectTeams.deletedAt))),
        db
          .select()
          .from(projectSections)
          .where(and(eq(projectSections.projectId, project.id), isNull(projectSections.deletedAt))),
      ]);
      assert.deepEqual(memberRows.map((member) => member.userId).sort(), [ownerId, managerId, memberId].sort());
      assert.deepEqual(
        teamRows.map((team) => team.teamId),
        [teamId],
      );
      assert.equal(sectionRows.length, 4);
    } finally {
      if (projectId) {
        await db
          .delete(tasks)
          .where(eq(tasks.projectId, projectId))
          .catch(() => undefined);
        await db
          .delete(projectSections)
          .where(eq(projectSections.projectId, projectId))
          .catch(() => undefined);
        await db
          .delete(projects)
          .where(eq(projects.id, projectId))
          .catch(() => undefined);
      }
      await db
        .delete(teams)
        .where(eq(teams.id, teamId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      for (const userId of [ownerId, managerId, memberId]) {
        await db
          .delete(users)
          .where(eq(users.id, userId))
          .catch(() => undefined);
      }
    }
  });
});
