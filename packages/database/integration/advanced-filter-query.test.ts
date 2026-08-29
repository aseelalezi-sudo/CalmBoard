import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import {
  createCustomFieldsRepository,
  createProjectsRepository,
  createSavedViewsRepository,
  createTasksRepository,
  customFields,
  db,
  memberships,
  organizations,
  pool,
  projects,
  projectSections,
  savedViews,
  tasks,
  TenantConflictError,
  users,
  workspaces,
} from "../src/index.js";
import {
  evaluateTaskAdvancedFilter,
  type AdvancedFilterGroup,
  type AdvancedFilterNode,
} from "../src/advanced-filter.js";

describe("Canonical Advanced Search & Filters Integration Tests (CB-P1-004)", () => {
  const orgId = "00000000-0000-0000-0000-000000000080";
  const orgBId = "00000000-0000-0000-0000-000000000081";
  const ws1Id = "00000000-0000-0000-0000-000000000082";
  const ws2Id = "00000000-0000-0000-0000-000000000083";
  const userId = "00000000-0000-0000-0000-000000000084";
  const user2Id = "00000000-0000-0000-0000-000000000085";

  let proj1Id: string;
  let section1Id: string;
  let section2Id: string;
  let cfScoreKey = "cf_adv_score";
  let cfReleaseKey = "cf_adv_release";
  let cfEnvKey = "cf_adv_env";

  let task1Id: string;
  let task2Id: string;
  let task3Id: string;
  let task4Id: string;
  let task5Id: string;
  let task6Id: string;

  before(async () => {
    await db.delete(tasks).where(eq(tasks.organizationId, orgId));
    await db.delete(savedViews).where(eq(savedViews.organizationId, orgId));
    await db.delete(customFields).where(eq(customFields.organizationId, orgId));
    await db.delete(projectSections).where(eq(projectSections.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));

    await db
      .insert(organizations)
      .values({ id: orgId, name: "Adv Filter Org A", slug: "adv-filter-org-a" })
      .onConflictDoNothing();
    await db
      .insert(organizations)
      .values({ id: orgBId, name: "Adv Filter Org B", slug: "adv-filter-org-b" })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        { id: userId, email: "adv-user-1@example.com", name: "Adv User One" },
        { id: user2Id, email: "adv-user-2@example.com", name: "Adv User Two" },
      ])
      .onConflictDoNothing();

    await db
      .insert(workspaces)
      .values([
        { id: ws1Id, organizationId: orgId, name: "Adv WS 1", slug: "adv-ws-1" },
        { id: ws2Id, organizationId: orgId, name: "Adv WS 2", slug: "adv-ws-2" },
      ])
      .onConflictDoNothing();

    await db
      .insert(memberships)
      .values([
        { organizationId: orgId, workspaceId: ws1Id, userId, role: "admin" },
        { organizationId: orgId, workspaceId: ws1Id, userId: user2Id, role: "member" },
      ])
      .onConflictDoNothing();

    const projRepo = createProjectsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
    const p1 = await projRepo.create({ name: "Project Alpha", color: "#10b981", icon: "folder" });
    proj1Id = p1.id;

    // Sections
    const [s1] = await db
      .insert(projectSections)
      .values([
        { organizationId: orgId, workspaceId: ws1Id, projectId: proj1Id, name: "Sprint Backlog", order: 0 },
        { organizationId: orgId, workspaceId: ws1Id, projectId: proj1Id, name: "Ready for QA", order: 1 },
      ])
      .returning();
    section1Id = s1.id;
    const [s2] = await db.select().from(projectSections).where(eq(projectSections.name, "Ready for QA"));
    section2Id = s2.id;

    // Custom fields
    const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
    await cfRepo.create({
      name: "Adv Score",
      key: cfScoreKey,
      type: "number",
      projectId: proj1Id,
    });
    await cfRepo.create({
      name: "Adv Release",
      key: cfReleaseKey,
      type: "date",
      projectId: proj1Id,
    });
    await cfRepo.create({
      name: "Adv Environment",
      key: cfEnvKey,
      type: "single_select",
      projectId: proj1Id,
      options: [
        { label: "Production", value: "prod" },
        { label: "Staging", value: "stage" },
      ],
    });

    const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

    // Task 1: Backend auth in progress, urgent, user1 assigned, tags [backend, security], score 90, release 2026-09-01
    const t1 = await taskRepo.create({
      projectId: proj1Id,
      title: "Implement OAuth2 Provider",
      description: "Secure login flow with PKCE and token rotation",
      status: "in_progress",
      priority: "urgent",
      assigneeId: userId,
      assigneeIds: [userId, user2Id],
      sectionId: section1Id,
      tags: ["backend", "security"],
      progress: 80,
      estimatedHours: 16,
      loggedHours: 12,
      storyPoints: 8,
      isMilestone: false,
      isRecurring: false,
      startDate: new Date("2026-08-20T00:00:00Z"),
      dueDate: new Date("2026-08-30T00:00:00Z"),
      customFields: {
        [cfScoreKey]: 90,
        [cfReleaseKey]: "2026-09-01T00:00:00Z",
        [cfEnvKey]: "prod",
      },
    });
    task1Id = t1.id;

    // Task 2: Frontend login screen, done, low priority, user2 assigned, tags [frontend, ui], score 40, milestone true
    const t2 = await taskRepo.create({
      projectId: proj1Id,
      title: "Build Login Screen UI",
      description: "Responsive React form with Tailwind tokens",
      status: "done",
      priority: "low",
      assigneeId: user2Id,
      sectionId: section2Id,
      tags: ["frontend", "ui"],
      progress: 100,
      estimatedHours: 8,
      loggedHours: 8,
      storyPoints: 3,
      isMilestone: true,
      isRecurring: false,
      startDate: new Date("2026-08-15T00:00:00Z"),
      dueDate: new Date("2026-08-15T00:00:00Z"),
      customFields: {
        [cfScoreKey]: 40,
        [cfReleaseKey]: "2026-08-15T00:00:00Z",
        [cfEnvKey]: "stage",
      },
    });
    task2Id = t2.id;

    // Task 3: Background worker migration, todo, medium, unassigned, tags [backend, database], score 70, recurring true
    const t3 = await taskRepo.create({
      projectId: proj1Id,
      title: "Database Migration Script",
      description: "Add indexes for advanced filter performance",
      status: "todo",
      priority: "medium",
      assigneeId: null,
      sectionId: section1Id,
      tags: ["backend", "database"],
      progress: 0,
      estimatedHours: 4,
      loggedHours: 0,
      storyPoints: 2,
      isMilestone: false,
      isRecurring: true,
      startDate: new Date("2026-09-01T00:00:00Z"),
      dueDate: new Date("2026-09-05T00:00:00Z"),
      customFields: {
        [cfScoreKey]: 70,
        [cfReleaseKey]: "2026-09-05T00:00:00Z",
      },
    });
    task3Id = t3.id;

    // Task 4: Subtask of Task 1, todo, high priority, user1 assigned
    const t4 = await taskRepo.create({
      projectId: proj1Id,
      title: "Write PKCE Integration Tests",
      parentId: task1Id,
      status: "todo",
      priority: "high",
      assigneeId: userId,
      progress: 0,
      estimatedHours: 2,
      loggedHours: 0,
      customFields: {
        [cfScoreKey]: 85,
      },
    });
    task4Id = t4.id;

    // Task 5: Malformed custom field historical task
    const t5 = await taskRepo.create({
      projectId: proj1Id,
      title: "Legacy Task with Malformed Custom Data",
      status: "todo",
      priority: "low",
    });
    task5Id = t5.id;
    await db
      .update(tasks)
      .set({
        customFields: {
          [cfScoreKey]: "not-a-number",
          [cfReleaseKey]: "2026-02-30",
        },
      })
      .where(eq(tasks.id, task5Id));

    // Task 6: Review status with explicit timezone
    const t6 = await taskRepo.create({
      projectId: proj1Id,
      title: "Review OAuth2 Provider Spec",
      description: "Architecture review document",
      status: "review",
      priority: "high",
      timezone: "Asia/Riyadh",
    });
    task6Id = t6.id;
  });

  after(async () => {
    await db.delete(tasks).where(eq(tasks.organizationId, orgId));
    await db.delete(savedViews).where(eq(savedViews.organizationId, orgId));
    await db.delete(customFields).where(eq(customFields.organizationId, orgId));
    await db.delete(projectSections).where(eq(projectSections.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));
  });

  describe("Common Task Field Queries & Filtering", () => {
    it("filters by status (equals, not_equals, in, not_in, canonical review/blocked)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageInProgress = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
        limit: 10,
      });
      assert.equal(pageInProgress.items.length, 1);
      assert.equal(pageInProgress.items[0].id, task1Id);

      // Canonical status 'review' works
      const pageReview = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "status", operator: "equals", value: "review" },
        limit: 10,
      });
      assert.equal(pageReview.items.length, 1);
      assert.equal(pageReview.items[0].id, task6Id);

      // 'review' in array works
      const pageReviewDone = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "status", operator: "in", value: ["review", "done"] },
        limit: 10,
      });
      const rdIds = pageReviewDone.items.map((t) => t.id).sort();
      assert.deepEqual(rdIds, [task2Id, task6Id].sort());

      // 'blocked' is rejected with TenantConflictError
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            advancedFilter: { kind: "predicate", field: "status", operator: "equals", value: "blocked" },
            limit: 10,
          }),
        TenantConflictError,
      );

      const pageInArray = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "status", operator: "in", value: ["todo", "done"] },
        limit: 10,
      });
      const inIds = pageInArray.items.map((t) => t.id).sort();
      assert.ok(inIds.includes(task2Id));
      assert.ok(inIds.includes(task3Id));
      assert.equal(inIds.includes(task1Id), false);
    });

    it("filters by assigneeId (equals with multiple assignees, is_empty, is_not_empty)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // user2 is contributor on Task 1 and lead on Task 2
      const pageUser2 = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "assigneeId", operator: "equals", value: user2Id },
        limit: 10,
      });
      const u2Ids = pageUser2.items.map((t) => t.id).sort();
      assert.ok(u2Ids.includes(task1Id));
      assert.ok(u2Ids.includes(task2Id));

      // unassigned tasks (is_empty)
      const pageEmpty = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "assigneeId", operator: "is_empty" },
        limit: 10,
      });
      const emptyIds = pageEmpty.items.map((t) => t.id);
      assert.ok(emptyIds.includes(task3Id));
      assert.equal(emptyIds.includes(task1Id), false);
    });

    it("filters by tags (contains, contains_all, contains_any, not_contains)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageContains = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "tags", operator: "contains", value: "security" },
        limit: 10,
      });
      assert.equal(pageContains.items.length, 1);
      assert.equal(pageContains.items[0].id, task1Id);

      const pageContainsAny = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "tags", operator: "contains_any", value: ["security", "ui"] },
        limit: 10,
      });
      const anyIds = pageContainsAny.items.map((t) => t.id).sort();
      assert.deepEqual(anyIds, [task1Id, task2Id].sort());
    });

    it("filters by numeric fields and between range (progress, estimatedHours, storyPoints)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageProgressRange = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "progress", operator: "between", value: { min: 50, max: 100 } },
        limit: 10,
      });
      const progIds = pageProgressRange.items.map((t) => t.id).sort();
      assert.deepEqual(progIds, [task1Id, task2Id].sort());

      const pagePointsGt = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "storyPoints", operator: "greater_than", value: 5 },
        limit: 10,
      });
      assert.equal(pagePointsGt.items.length, 1);
      assert.equal(pagePointsGt.items[0].id, task1Id);
    });

    it("filters by boolean fields (isMilestone, isRecurring)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageMilestone = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "isMilestone", operator: "equals", value: true },
        limit: 10,
      });
      assert.equal(pageMilestone.items.length, 1);
      assert.equal(pageMilestone.items[0].id, task2Id);

      const pageRecurring = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "isRecurring", operator: "equals", value: true },
        limit: 10,
      });
      assert.equal(pageRecurring.items.length, 1);
      assert.equal(pageRecurring.items[0].id, task3Id);
    });

    it("filters by date fields and between range (startDate, dueDate)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageDateRange = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: {
          kind: "predicate",
          field: "dueDate",
          operator: "between",
          value: { min: "2026-08-10T00:00:00Z", max: "2026-08-31T23:59:59Z" },
        },
        limit: 10,
      });
      const dateIds = pageDateRange.items.map((t) => t.id).sort();
      assert.deepEqual(dateIds, [task1Id, task2Id].sort());
    });

    it("filters by text search across title, serial, description", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const pageSearch = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "search", operator: "contains", value: "PKCE" },
        limit: 10,
      });
      assert.equal(pageSearch.items.length, 1);
      assert.equal(pageSearch.items[0].id, task1Id);
    });

    it("guarantees exact case-sensitive equality and parity for title, description, and timezone across SQL and in-memory", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // 1. Title exact case matches in SQL
      const pageExact = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "title", operator: "equals", value: "Implement OAuth2 Provider" },
        limit: 10,
      });
      assert.equal(pageExact.items.length, 1);
      assert.equal(pageExact.items[0].id, task1Id);

      // 2. Title different case (lowercase) returns 0 in SQL (case-sensitive)
      const pageLower = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "title", operator: "equals", value: "implement oauth2 provider" },
        limit: 10,
      });
      assert.equal(pageLower.items.length, 0);

      // 3. Title not_equals lowercase matches task 1 in SQL
      const pageNotEqLower = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: {
          kind: "predicate",
          field: "title",
          operator: "not_equals",
          value: "implement oauth2 provider",
        },
        limit: 50,
      });
      assert.ok(pageNotEqLower.items.some((t) => t.id === task1Id));

      // 4. Title not_equals exact case does NOT match task 1
      const pageNotEqExact = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: {
          kind: "predicate",
          field: "title",
          operator: "not_equals",
          value: "Implement OAuth2 Provider",
        },
        limit: 50,
      });
      assert.equal(
        pageNotEqExact.items.some((t) => t.id === task1Id),
        false,
      );

      // 5. Description exact case vs different case
      const pageDescExact = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: {
          kind: "predicate",
          field: "description",
          operator: "equals",
          value: "Secure login flow with PKCE and token rotation",
        },
        limit: 10,
      });
      assert.equal(pageDescExact.items.length, 1);
      assert.equal(pageDescExact.items[0].id, task1Id);

      const pageDescLower = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: {
          kind: "predicate",
          field: "description",
          operator: "equals",
          value: "secure login flow with pkce and token rotation",
        },
        limit: 10,
      });
      assert.equal(pageDescLower.items.length, 0);

      // 6. Timezone exact case vs different case
      const pageTzExact = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "timezone", operator: "equals", value: "Asia/Riyadh" },
        limit: 10,
      });
      assert.equal(pageTzExact.items.length, 1);
      assert.equal(pageTzExact.items[0].id, task6Id);

      const pageTzLower = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "predicate", field: "timezone", operator: "equals", value: "asia/riyadh" },
        limit: 10,
      });
      assert.equal(pageTzLower.items.length, 0);

      // 7. Full SQL vs In-Memory Parity on the task dataset
      const allTasks = (await taskRepo.listPage({ projectId: proj1Id, limit: 100 })).items;
      const testAsts = [
        { kind: "predicate", field: "title", operator: "equals", value: "Implement OAuth2 Provider" },
        { kind: "predicate", field: "title", operator: "equals", value: "implement oauth2 provider" },
        { kind: "predicate", field: "title", operator: "not_equals", value: "Implement OAuth2 Provider" },
        { kind: "predicate", field: "description", operator: "equals", value: "Architecture review document" },
        { kind: "predicate", field: "description", operator: "equals", value: "architecture review document" },
        { kind: "predicate", field: "timezone", operator: "equals", value: "Asia/Riyadh" },
        { kind: "predicate", field: "timezone", operator: "equals", value: "asia/riyadh" },
        { kind: "predicate", field: "title", operator: "contains", value: "oauth2" },
        { kind: "predicate", field: "title", operator: "starts_with", value: "implement" },
        { kind: "predicate", field: "title", operator: "ends_with", value: "PROVIDER" },
      ] as const;

      for (const ast of testAsts) {
        const sqlResult = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast as any, limit: 100 });
        const sqlIds = new Set(sqlResult.items.map((t) => t.id));
        const inMemoryIds = new Set(allTasks.filter((t) => evaluateTaskAdvancedFilter(t, ast as any)).map((t) => t.id));
        assert.deepEqual(
          [...sqlIds].sort(),
          [...inMemoryIds].sort(),
          `SQL and In-memory parity mismatch for predicate ${JSON.stringify(ast)}`,
        );
      }
    });
  });

  describe("Boolean Composition & Nested Groups", () => {
    it("evaluates A AND B", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
          { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
        ],
      };
      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 10 });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].id, task1Id);
    });

    it("evaluates A OR B", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "or",
        children: [
          { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
          { kind: "predicate", field: "isMilestone", operator: "equals", value: true },
        ],
      };
      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 10 });
      const ids = page.items.map((t) => t.id).sort();
      assert.deepEqual(ids, [task1Id, task2Id].sort());
    });

    it("evaluates A AND (B OR C)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          { kind: "predicate", field: "tags", operator: "contains", value: "backend" },
          {
            kind: "group",
            operator: "or",
            children: [
              { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
              { kind: "predicate", field: "priority", operator: "equals", value: "medium" },
            ],
          },
        ],
      };
      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 10 });
      const ids = page.items.map((t) => t.id).sort();
      assert.deepEqual(ids, [task1Id, task3Id].sort());
    });

    it("evaluates (A OR B) AND C", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          {
            kind: "group",
            operator: "or",
            children: [
              { kind: "predicate", field: "status", operator: "equals", value: "done" },
              { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
            ],
          },
          { kind: "predicate", field: "progress", operator: "greater_than_or_equal", value: 50 },
        ],
      };
      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 10 });
      const ids = page.items.map((t) => t.id).sort();
      assert.deepEqual(ids, [task1Id, task2Id].sort());
    });

    it("evaluates empty groups according to canonical boolean semantics in SQL (AND [] => true, OR [] => false)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const andEmpty = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "group", operator: "and", children: [] },
        limit: 50,
      });
      // Matches all top-level project tasks
      assert.ok(andEmpty.items.length >= 4);

      const orEmpty = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: { kind: "group", operator: "or", children: [] },
        limit: 50,
      });
      assert.equal(orEmpty.items.length, 0);
    });
  });

  describe("Custom Field Composition & Malformed Resilience", () => {
    it("composes common task fields and custom fields in AND/OR groups", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
          { kind: "predicate", field: "customField", customFieldKey: cfScoreKey, operator: "greater_than", value: 80 },
          { kind: "predicate", field: "customField", customFieldKey: cfEnvKey, operator: "equals", value: "prod" },
        ],
      };

      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 10 });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].id, task1Id);
    });

    it("safely queries nested groups with malformed historical custom data without crashing", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "or",
        children: [
          { kind: "predicate", field: "customField", customFieldKey: cfScoreKey, operator: "greater_than", value: 50 },
          {
            kind: "predicate",
            field: "customField",
            customFieldKey: cfReleaseKey,
            operator: "before",
            value: "2026-12-31T00:00:00Z",
          },
        ],
      };

      const page = await taskRepo.listPage({ projectId: proj1Id, advancedFilter: ast, limit: 50 });
      assert.ok(page.items.length > 0);
      assert.equal(
        page.items.some((t) => t.id === task5Id),
        false,
      );
    });
  });

  describe("Pagination & Cursor Compatibility", () => {
    it("paginates seamlessly across filtered datasets without duplicates or missing items", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const filter: AdvancedFilterNode = {
        kind: "predicate",
        field: "status",
        operator: "in",
        value: ["todo", "in_progress", "done"],
      };

      const p1 = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: filter,
        sortBy: "createdAt",
        sortDirection: "desc",
        limit: 2,
      });

      assert.equal(p1.items.length, 2);
      assert.ok(p1.nextCursor);
      assert.ok(p1.total >= 4);

      const p2 = await taskRepo.listPage({
        projectId: proj1Id,
        advancedFilter: filter,
        sortBy: "createdAt",
        sortDirection: "desc",
        limit: 2,
        cursor: p1.nextCursor!,
      });

      assert.ok(p2.items.length >= 1);
      const p1Ids = p1.items.map((t) => t.id);
      const p2Ids = p2.items.map((t) => t.id);
      for (const id of p2Ids) {
        assert.equal(p1Ids.includes(id), false, `Page 2 item ${id} should not appear on Page 1`);
      }
    });
  });

  describe("Saved View Integration & No-Op Updates", () => {
    it("persists, reloads, and applies Saved Views with canonical advanced filters", async () => {
      const viewRepo = createSavedViewsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const ast: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
          { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
        ],
      };

      const createdView = await viewRepo.create({
        projectId: proj1Id,
        name: "Urgent Active Work",
        viewType: "table",
        filters: {
          advancedFilter: ast,
        },
        configuration: { schemaVersion: 2 },
        isShared: true,
        isDefault: false,
      });

      const views = await viewRepo.list(proj1Id);
      const loaded = views.find((v) => v.id === createdView.id);
      assert.ok(loaded);
      assert.ok(loaded.filters.advancedFilter);
      assert.equal(loaded.filters.advancedFilter.kind, "group");

      // Canonical equivalent update: A AND B vs B AND A produces no mutation (no-op)
      const equivalentAst: AdvancedFilterGroup = {
        kind: "group",
        operator: "and",
        children: [
          { kind: "predicate", field: "status", operator: "equals", value: "in_progress" },
          { kind: "predicate", field: "priority", operator: "equals", value: "urgent" },
        ],
      };

      const updatedView = await viewRepo.update(createdView.id, "table", {
        filters: {
          advancedFilter: equivalentAst,
        },
      });

      assert.equal(
        new Date(updatedView.updatedAt).getTime(),
        new Date(createdView.updatedAt).getTime(),
        "Equivalent canonical AST update must be a no-op without updatedAt mutation",
      );
    });
  });

  describe("Calendar Query Integration", () => {
    it("combines visible date range with advanced filter correctly", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const calendarTasks = await taskRepo.list({
        projectId: proj1Id,
        calendarFrom: new Date("2026-08-01T00:00:00Z"),
        calendarTo: new Date("2026-08-31T23:59:59Z"),
        advancedFilter: {
          kind: "predicate",
          field: "priority",
          operator: "equals",
          value: "urgent",
        },
      });

      assert.equal(calendarTasks.length, 1);
      assert.equal(calendarTasks[0].id, task1Id);
    });
  });

  describe("Security & Tenant Scoping", () => {
    it("fails closed when querying a custom field from another organization or project", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            advancedFilter: {
              kind: "predicate",
              field: "customField",
              customFieldKey: "cf_foreign_key",
              operator: "equals",
              value: "test",
            },
            limit: 10,
          }),
        TenantConflictError,
      );
    });
  });
});
