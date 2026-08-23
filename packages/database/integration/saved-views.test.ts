import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createSavedViewsRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  savedViews,
  tasks,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("owner-scoped saved views", () => {
  it("persists table state, protects private views, and keeps one default", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.com`, name: "View owner" },
        { id: memberId, email: `${memberId}@example.com`, name: "View member" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Saved views org",
        slug: `saved-views-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Saved views workspace",
        slug: `saved-views-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, workspaceId: null, role: "owner" },
        { userId: memberId, organizationId, workspaceId: null, role: "member" },
      ]);
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Saved views" });

      const owner = createSavedViewsRepository({ organizationId, workspaceId, actorId: ownerId });
      const member = createSavedViewsRepository({ organizationId, workspaceId, actorId: memberId });
      const first = await owner.create({
        projectId,
        name: "Private table",
        viewType: "table",
        filters: { priority: "high" },
        configuration: { schemaVersion: 1, table: { columnSizing: { title: 380 } } },
        isShared: false,
        isDefault: true,
      });
      const second = await owner.create({
        projectId,
        name: "Shared board",
        viewType: "board",
        filters: { status: "todo" },
        configuration: { schemaVersion: 2, board: { groupBy: "priority", collapsedColumns: {} } },
        isShared: true,
        isDefault: true,
      });

      const ownerViews = await owner.list(projectId);
      assert.equal(ownerViews.length, 2);
      assert.equal(ownerViews.find((view) => view.id === first.id)?.isDefault, false);
      assert.equal(ownerViews.find((view) => view.id === second.id)?.isDefault, true);
      const memberViews = await member.list(projectId);
      assert.deepEqual(
        memberViews.map((view) => view.id),
        [second.id],
      );
      await assert.rejects(() => member.delete(second.id), /saved view was not found/);

      const updated = await owner.update(first.id, "table", {
        configuration: { schemaVersion: 2, table: { columnSizing: { title: 460 } } },
      });
      assert.equal(
        (updated.configuration as { table?: { columnSizing?: { title?: number } } }).table?.columnSizing?.title,
        460,
      );
      await assert.rejects(() => owner.update(first.id, "board", { name: "Wrong type" }), /type does not match/);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, memberId))
        .catch(() => undefined);
    }
  });

  it("prunes invalid, deleted, and foreign task IDs from custom groups", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const ownerId = randomUUID();
    const validTaskId = randomUUID();
    const deletedTaskId = randomUUID();
    const foreignTaskId = randomUUID();

    try {
      await db.insert(users).values({ id: ownerId, email: `${ownerId}@example.com`, name: "Task Owner" });
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Custom Group Org",
        slug: `cg-org-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Custom Group WS",
        slug: `cg-ws-${workspaceId}`,
      });
      await db.insert(memberships).values({
        userId: ownerId,
        organizationId,
        workspaceId: null,
        role: "owner",
      });
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "Main Project" },
        { id: otherProjectId, organizationId, workspaceId, name: "Other Project" },
      ]);

      // Insert valid task, deleted task in same project, and foreign task in another project
      await db.insert(tasks).values([
        {
          id: validTaskId,
          serial: 1,
          organizationId,
          workspaceId,
          projectId,
          title: "Valid Task",
          status: "todo",
          priority: "medium",
          type: "task",
          reporterId: ownerId,
        },
        {
          id: deletedTaskId,
          serial: 2,
          organizationId,
          workspaceId,
          projectId,
          title: "Deleted Task",
          status: "todo",
          priority: "medium",
          type: "task",
          reporterId: ownerId,
          deletedAt: new Date(),
        },
        {
          id: foreignTaskId,
          serial: 3,
          organizationId,
          workspaceId,
          projectId: otherProjectId,
          title: "Foreign Task",
          status: "todo",
          priority: "medium",
          type: "task",
          reporterId: ownerId,
        },
      ]);

      const repo = createSavedViewsRepository({ organizationId, workspaceId, actorId: ownerId });

      const created = await repo.create({
        projectId,
        name: "Table with Custom Groups",
        viewType: "table",
        filters: {},
        configuration: {
          schemaVersion: 2,
          table: {
            groupBy: "custom",
            customGroups: [
              {
                id: "grp-1",
                name: "Phase 1",
                color: "indigo",
                taskIds: [validTaskId, deletedTaskId, foreignTaskId, randomUUID()],
              },
            ],
          },
        },
        isShared: false,
        isDefault: false,
      });

      assert.equal(created.configuration.table?.customGroups?.[0]?.taskIds.length, 1);
      assert.deepEqual(created.configuration.table?.customGroups?.[0]?.taskIds, [validTaskId]);

      // Now test listing prunes appropriately
      const listed = await repo.list(projectId);
      const fetched = listed.find((v) => v.id === created.id);
      assert.ok(fetched);
      assert.deepEqual(fetched.configuration.table?.customGroups?.[0]?.taskIds, [validTaskId]);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
    }
  });

  it("handles canonical no-op updates without changing updated_at timestamp or writing redundant mutations", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const ownerId = randomUUID();

    try {
      await db.insert(users).values({ id: ownerId, email: `${ownerId}@example.com`, name: "Noop Owner" });
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Noop Org",
        slug: `noop-org-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Noop WS",
        slug: `noop-ws-${workspaceId}`,
      });
      await db.insert(memberships).values({
        userId: ownerId,
        organizationId,
        workspaceId: null,
        role: "owner",
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Noop Project" });

      const repo = createSavedViewsRepository({ organizationId, workspaceId, actorId: ownerId });

      const created = await repo.create({
        projectId,
        name: "Timeline View",
        viewType: "timeline",
        filters: { status: "in_progress", priority: "high" },
        configuration: {
          schemaVersion: 2,
          timeline: { zoom: "months", showCritical: true },
        },
        isShared: true,
        isDefault: true,
      });

      // Update with identical canonical values but different object key order
      const noopUpdate = await repo.update(created.id, "timeline", {
        name: "Timeline View",
        filters: { priority: "high", status: "in_progress" },
        configuration: {
          schemaVersion: 2,
          timeline: { showCritical: true, zoom: "months" },
        },
        isShared: true,
        isDefault: true,
      });

      assert.equal(noopUpdate.id, created.id);
      assert.deepEqual(noopUpdate.updatedAt, created.updatedAt);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
    }
  });

  it("loads and preserves backward compatibility with raw schemaVersion 1 legacy views", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const ownerId = randomUUID();
    const legacyViewId = randomUUID();

    try {
      await db.insert(users).values({ id: ownerId, email: `${ownerId}@example.com`, name: "Legacy Owner" });
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Legacy Org",
        slug: `legacy-org-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Legacy WS",
        slug: `legacy-ws-${workspaceId}`,
      });
      await db.insert(memberships).values({
        userId: ownerId,
        organizationId,
        workspaceId: null,
        role: "owner",
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Legacy Project" });

      // Directly insert legacy v1 JSON into database
      await db.insert(savedViews).values({
        id: legacyViewId,
        organizationId,
        workspaceId,
        projectId,
        name: "Legacy v1 Table",
        viewType: "table",
        filters: { status: "todo" },
        configuration: {
          schemaVersion: 1,
          table: {
            columnSizing: { title: 320, due: 150 },
            columnOrder: ["select", "title", "due"],
          },
        },
        isShared: true,
        isDefault: true,
        createdBy: ownerId,
      });

      const repo = createSavedViewsRepository({ organizationId, workspaceId, actorId: ownerId });
      const listed = await repo.list(projectId);
      const found = listed.find((v) => v.id === legacyViewId);

      assert.ok(found);
      assert.equal(found.name, "Legacy v1 Table");
      assert.equal(found.configuration.schemaVersion, 1);
      assert.equal(found.configuration.table?.columnSizing?.title, 320);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
    }
  });

  it("enforces project-level single default invariant across users, updates, deletions, and DB constraints", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const project1Id = randomUUID();
    const project2Id = randomUUID();
    const userAId = randomUUID();
    const userBId = randomUUID();

    try {
      await db.insert(users).values([
        { id: userAId, email: `user-a-${userAId}@example.com`, name: "User A" },
        { id: userBId, email: `user-b-${userBId}@example.com`, name: "User B" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        ownerId: userAId,
        name: "Default Invariant Org",
        slug: `def-org-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Default Invariant WS",
        slug: `def-ws-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: userAId, organizationId, workspaceId: null, role: "owner" },
        { userId: userBId, organizationId, workspaceId: null, role: "member" },
      ]);
      await db.insert(projects).values([
        { id: project1Id, organizationId, workspaceId, name: "Project 1" },
        { id: project2Id, organizationId, workspaceId, name: "Project 2" },
      ]);

      const repoA = createSavedViewsRepository({ organizationId, workspaceId, actorId: userAId });
      const repoB = createSavedViewsRepository({ organizationId, workspaceId, actorId: userBId });

      // Step A: User A creates default view A in Project 1
      const viewA = await repoA.create({
        projectId: project1Id,
        name: "View A (User A)",
        viewType: "table",
        filters: { status: "todo" },
        configuration: { schemaVersion: 2, table: {} },
        isShared: true,
        isDefault: true,
      });
      assert.equal(viewA.isDefault, true);

      // Step B: User B creates default view B in same Project 1
      // View A must become isDefault = false, and View B becomes isDefault = true
      const viewB = await repoB.create({
        projectId: project1Id,
        name: "View B (User B)",
        viewType: "board",
        filters: { priority: "high" },
        configuration: { schemaVersion: 2, board: {} },
        isShared: true,
        isDefault: true,
      });
      assert.equal(viewB.isDefault, true);

      const viewsAfterB = await repoA.list(project1Id);
      const fetchedA = viewsAfterB.find((v) => v.id === viewA.id);
      const fetchedB = viewsAfterB.find((v) => v.id === viewB.id);
      assert.equal(fetchedA?.isDefault, false, "User A view must be switched to non-default");
      assert.equal(fetchedB?.isDefault, true, "User B view must be the default");

      // Verify exactly ONE active default exists in DB for Project 1
      const activeDefaultsP1 = await db.select().from(savedViews).where(eq(savedViews.projectId, project1Id));
      const activeP1Defaults = activeDefaultsP1.filter((v) => v.isDefault && !v.deletedAt);
      assert.equal(activeP1Defaults.length, 1);
      assert.equal(activeP1Defaults[0]?.id, viewB.id);

      // Step C: User A updates View A to isDefault = true
      // View B must become isDefault = false
      const updatedA = await repoA.update(viewA.id, "table", { isDefault: true });
      assert.equal(updatedA.isDefault, true);

      const viewsAfterUpdateA = await repoA.list(project1Id);
      assert.equal(viewsAfterUpdateA.find((v) => v.id === viewA.id)?.isDefault, true);
      assert.equal(viewsAfterUpdateA.find((v) => v.id === viewB.id)?.isDefault, false);

      // Step D: Re-saving already-default View A (true no-op)
      const noopUpdate = await repoA.update(viewA.id, "table", { isDefault: true });
      assert.equal(noopUpdate.id, viewA.id);
      assert.deepEqual(noopUpdate.updatedAt, updatedA.updatedAt);

      // Step E: Cross-project defaults: Project 2 default does not affect Project 1
      const viewC = await repoA.create({
        projectId: project2Id,
        name: "View C (Project 2)",
        viewType: "list",
        filters: {},
        configuration: { schemaVersion: 2, list: {} },
        isShared: true,
        isDefault: true,
      });
      assert.equal(viewC.isDefault, true);
      const p1Check = await repoA.list(project1Id);
      assert.equal(p1Check.find((v) => v.id === viewA.id)?.isDefault, true);

      // Step F: Setting isDefault = false simply removes default
      const unsetA = await repoA.update(viewA.id, "table", { isDefault: false });
      assert.equal(unsetA.isDefault, false);
      const viewsAfterUnset = await repoA.list(project1Id);
      assert.equal(
        viewsAfterUnset.some((v) => v.isDefault),
        false,
      );

      // Step G: Deleting a default view
      const viewD = await repoA.create({
        projectId: project1Id,
        name: "View D to delete",
        viewType: "timeline",
        filters: {},
        configuration: { schemaVersion: 2, timeline: {} },
        isShared: true,
        isDefault: true,
      });
      assert.equal(viewD.isDefault, true);
      await repoA.delete(viewD.id);
      const viewsAfterDelete = await repoA.list(project1Id);
      assert.equal(
        viewsAfterDelete.some((v) => v.id === viewD.id),
        false,
      );

      // Can create a new default view with no conflict
      const viewE = await repoB.create({
        projectId: project1Id,
        name: "View E new default",
        viewType: "table",
        filters: {},
        configuration: { schemaVersion: 2, table: {} },
        isShared: true,
        isDefault: true,
      });
      assert.equal(viewE.isDefault, true);

      // Step H: Non-creator cannot mutate private view
      const privateViewA = await repoA.create({
        projectId: project1Id,
        name: "Private View A",
        viewType: "table",
        filters: {},
        configuration: { schemaVersion: 2, table: {} },
        isShared: false,
        isDefault: false,
      });
      await assert.rejects(
        () => repoB.update(privateViewA.id, "table", { name: "Hacked" }),
        /saved view was not found/,
      );

      // Step I: Direct DB uniqueness constraint test
      // Attempting to insert a duplicate active default in DB violates saved_views_project_default_unique
      await assert.rejects(
        () =>
          db.insert(savedViews).values({
            id: randomUUID(),
            organizationId,
            workspaceId,
            projectId: project1Id,
            name: "Violating default",
            viewType: "table",
            filters: {},
            configuration: { schemaVersion: 2 },
            isShared: true,
            isDefault: true,
            createdBy: userAId,
          }),
        (err: any) => {
          const text = `${err?.message || ""} ${err?.cause?.message || ""}`;
          return /saved_views_project_default_unique|duplicate key/i.test(text);
        },
      );
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userAId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userBId))
        .catch(() => undefined);
    }
  });
});
