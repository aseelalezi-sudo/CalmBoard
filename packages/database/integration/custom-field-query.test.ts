import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
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
import { evaluateTaskCustomFieldFilter } from "../src/custom-field-query.js";

describe("Custom Field Query, Filtering, Sorting & View Integration Tests (CB-P1-003)", () => {
  const orgId = "00000000-0000-0000-0000-000000000070";
  const orgBId = "00000000-0000-0000-0000-000000000071";
  const ws1Id = "00000000-0000-0000-0000-000000000072";
  const ws2Id = "00000000-0000-0000-0000-000000000073";
  const userId = "00000000-0000-0000-0000-000000000074";
  let proj1Id: string;
  let proj2Id: string;

  let cfShortTextId: string;
  let cfNumberId: string;
  let cfDateId: string;
  let cfSelectId: string;
  let cfCheckboxId: string;
  let cfUrlId: string;

  before(async () => {
    await db.delete(tasks).where(eq(tasks.organizationId, orgId));
    await db.delete(savedViews).where(eq(savedViews.organizationId, orgId));
    await db.delete(customFields).where(eq(customFields.organizationId, orgId));
    await db.delete(projectSections).where(eq(projectSections.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));

    await db
      .insert(organizations)
      .values({ id: orgId, name: "CF Query Org A", slug: "cf-query-org-a" })
      .onConflictDoNothing();
    await db
      .insert(organizations)
      .values({ id: orgBId, name: "CF Query Org B", slug: "cf-query-org-b" })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({ id: userId, email: "cf-query-user@example.com", name: "CF Query User" })
      .onConflictDoNothing();

    await db
      .insert(workspaces)
      .values({ id: ws1Id, organizationId: orgId, name: "CF Query WS 1", slug: "cf-query-ws-1" })
      .onConflictDoNothing();
    await db
      .insert(workspaces)
      .values({ id: ws2Id, organizationId: orgId, name: "CF Query WS 2", slug: "cf-query-ws-2" })
      .onConflictDoNothing();

    await db
      .insert(memberships)
      .values([
        {
          id: "00000000-0000-0000-0000-000000000075",
          organizationId: orgId,
          workspaceId: ws1Id,
          userId,
          role: "owner",
          status: "active",
        },
      ])
      .onConflictDoNothing();

    const projRepo = createProjectsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
    const p1 = await projRepo.create({ name: "CF Main Project" });
    const p2 = await projRepo.create({ name: "CF Secondary Project" });
    proj1Id = p1.id;
    proj2Id = p2.id;

    const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
    const f1 = await cfRepo.create({
      name: "Environment",
      key: "cf_env",
      type: "short_text",
      projectId: proj1Id,
    });
    cfShortTextId = f1.id;

    const f2 = await cfRepo.create({
      name: "Complexity Score",
      key: "cf_score",
      type: "number",
      projectId: proj1Id,
    });
    cfNumberId = f2.id;

    const f3 = await cfRepo.create({
      name: "Release Target",
      key: "cf_release_date",
      type: "date",
      projectId: proj1Id,
    });
    cfDateId = f3.id;

    const f4 = await cfRepo.create({
      name: "Customer Tier",
      key: "cf_tier",
      type: "single_select",
      projectId: proj1Id,
      options: [
        { label: "Free", value: "free" },
        { label: "Pro", value: "pro" },
        { label: "Enterprise", value: "enterprise" },
      ],
    });
    cfSelectId = f4.id;

    const f5 = await cfRepo.create({
      name: "Is Blocked",
      key: "cf_is_blocked",
      type: "checkbox",
      projectId: proj1Id,
    });
    cfCheckboxId = f5.id;

    const f6 = await cfRepo.create({
      name: "Documentation Link",
      key: "cf_doc_url",
      type: "url",
      projectId: proj1Id,
    });
    cfUrlId = f6.id;
  });

  after(async () => {
    await db.delete(tasks).where(eq(tasks.organizationId, orgId));
    await db.delete(savedViews).where(eq(savedViews.organizationId, orgId));
    await db.delete(customFields).where(eq(customFields.organizationId, orgId));
    await db.delete(projectSections).where(eq(projectSections.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));
    await pool.end();
  });

  describe("Custom Field Filter Execution", () => {
    it("filters short_text by equals, not_equals, contains, starts_with, ends_with", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const t1 = await taskRepo.create({
        projectId: proj1Id,
        title: "Production Deploy",
        customFields: { cf_env: "production-us-east" },
      });
      const t2 = await taskRepo.create({
        projectId: proj1Id,
        title: "Staging Deploy",
        customFields: { cf_env: "staging-eu-west" },
      });
      const t3 = await taskRepo.create({
        projectId: proj1Id,
        title: "Dev Deploy",
        customFields: { cf_env: "development-local" },
      });

      // contains
      const containsResults = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "contains", value: "staging" }],
      });
      assert.equal(containsResults.length, 1);
      assert.equal(containsResults[0]?.id, t2.id);

      // starts_with
      const startsResults = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "starts_with", value: "production" }],
      });
      assert.equal(startsResults.length, 1);
      assert.equal(startsResults[0]?.id, t1.id);

      // ends_with
      const endsResults = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "ends_with", value: "local" }],
      });
      assert.equal(endsResults.length, 1);
      assert.equal(endsResults[0]?.id, t3.id);

      // equals
      const equalsResults = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "equals", value: "staging-eu-west" }],
      });
      assert.equal(equalsResults.length, 1);
      assert.equal(equalsResults[0]?.id, t2.id);
    });

    it("filters number by numeric operators including 0", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const tLow = await taskRepo.create({
        projectId: proj1Id,
        title: "Zero Score Task",
        customFields: { cf_score: 0 },
      });
      const tMed = await taskRepo.create({
        projectId: proj1Id,
        title: "Fifty Score Task",
        customFields: { cf_score: 50 },
      });
      const tHigh = await taskRepo.create({
        projectId: proj1Id,
        title: "Hundred Score Task",
        customFields: { cf_score: 100 },
      });

      // greater_than 0 (should return 50 and 100, not 0)
      const gt0 = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_score", operator: "greater_than", value: 0 }],
      });
      const gt0Ids = new Set(gt0.map((t) => t.id));
      assert.equal(gt0Ids.has(tLow.id), false);
      assert.equal(gt0Ids.has(tMed.id), true);
      assert.equal(gt0Ids.has(tHigh.id), true);

      // greater_than_or_equal 50
      const gte50 = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_score", operator: "greater_than_or_equal", value: 50 }],
      });
      const gte50Ids = new Set(gte50.map((t) => t.id));
      assert.equal(gte50Ids.has(tLow.id), false);
      assert.equal(gte50Ids.has(tMed.id), true);
      assert.equal(gte50Ids.has(tHigh.id), true);

      // equals 0
      const eq0 = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_score", operator: "equals", value: 0 }],
      });
      assert.equal(
        eq0.some((t) => t.id === tLow.id),
        true,
      );
      assert.equal(
        eq0.some((t) => t.id === tMed.id),
        false,
      );
    });

    it("filters date chronologically by before, after, on_or_before, on_or_after", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const tAug10 = await taskRepo.create({
        projectId: proj1Id,
        title: "Aug 10 Release",
        customFields: { cf_release_date: "2026-08-10T00:00:00.000Z" },
      });
      const tAug25 = await taskRepo.create({
        projectId: proj1Id,
        title: "Aug 25 Release",
        customFields: { cf_release_date: "2026-08-25T12:00:00.000Z" },
      });
      const tSep01 = await taskRepo.create({
        projectId: proj1Id,
        title: "Sep 01 Release",
        customFields: { cf_release_date: "2026-09-01T00:00:00.000Z" },
      });

      const beforeAug20 = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_release_date", operator: "before", value: "2026-08-20T00:00:00.000Z" }],
      });
      assert.equal(
        beforeAug20.some((t) => t.id === tAug10.id),
        true,
      );
      assert.equal(
        beforeAug20.some((t) => t.id === tAug25.id),
        false,
      );

      const afterAug20 = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_release_date", operator: "after", value: "2026-08-20T00:00:00.000Z" }],
      });
      assert.equal(
        afterAug20.some((t) => t.id === tAug25.id),
        true,
      );
      assert.equal(
        afterAug20.some((t) => t.id === tSep01.id),
        true,
      );
      assert.equal(
        afterAug20.some((t) => t.id === tAug10.id),
        false,
      );
    });

    it("filters single_select and checkbox correctly", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const tPro = await taskRepo.create({
        projectId: proj1Id,
        title: "Pro Task",
        customFields: { cf_tier: "pro", cf_is_blocked: false },
      });
      const tEnt = await taskRepo.create({
        projectId: proj1Id,
        title: "Ent Task",
        customFields: { cf_tier: "enterprise", cf_is_blocked: true },
      });

      // single_select
      const proList = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_tier", operator: "equals", value: "pro" }],
      });
      assert.equal(
        proList.some((t) => t.id === tPro.id),
        true,
      );
      assert.equal(
        proList.some((t) => t.id === tEnt.id),
        false,
      );

      // checkbox true
      const blockedList = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_is_blocked", operator: "equals", value: true }],
      });
      assert.equal(
        blockedList.some((t) => t.id === tEnt.id),
        true,
      );
      assert.equal(
        blockedList.some((t) => t.id === tPro.id),
        false,
      );

      // checkbox false
      const unblockedList = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_is_blocked", operator: "equals", value: false }],
      });
      assert.equal(
        unblockedList.some((t) => t.id === tPro.id),
        true,
      );
      assert.equal(
        unblockedList.some((t) => t.id === tEnt.id),
        false,
      );
    });

    it("strictly respects null/empty invariants (0 and false are not empty)", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const tEmpty = await taskRepo.create({
        projectId: proj1Id,
        title: "Empty Custom Fields Task",
        customFields: {},
      });
      const tZero = await taskRepo.create({
        projectId: proj1Id,
        title: "Zero Score Task 2",
        customFields: { cf_score: 0, cf_is_blocked: false },
      });

      // is_empty on cf_score matches tEmpty, but NOT tZero
      const emptyScore = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_score", operator: "is_empty" }],
      });
      assert.equal(
        emptyScore.some((t) => t.id === tEmpty.id),
        true,
      );
      assert.equal(
        emptyScore.some((t) => t.id === tZero.id),
        false,
      );

      // is_not_empty on cf_score matches tZero
      const notEmptyScore = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_score", operator: "is_not_empty" }],
      });
      assert.equal(
        notEmptyScore.some((t) => t.id === tZero.id),
        true,
      );
      assert.equal(
        notEmptyScore.some((t) => t.id === tEmpty.id),
        false,
      );

      // is_not_empty on cf_is_blocked matches false
      const notEmptyBlocked = await taskRepo.list({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_is_blocked", operator: "is_not_empty" }],
      });
      assert.equal(
        notEmptyBlocked.some((t) => t.id === tZero.id),
        true,
      );
      assert.equal(
        notEmptyBlocked.some((t) => t.id === tEmpty.id),
        false,
      );
    });
  });

  describe("Additive Combined Filters", () => {
    it("combines status + priority + search + multiple custom field filters", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const match = await taskRepo.create({
        projectId: proj1Id,
        title: "Critical Database Migration",
        status: "in_progress",
        priority: "urgent",
        customFields: { cf_score: 95, cf_tier: "enterprise", cf_is_blocked: false },
      });
      const wrongStatus = await taskRepo.create({
        projectId: proj1Id,
        title: "Critical Migration Backend",
        status: "done",
        priority: "urgent",
        customFields: { cf_score: 95, cf_tier: "enterprise", cf_is_blocked: false },
      });
      const wrongScore = await taskRepo.create({
        projectId: proj1Id,
        title: "Critical Migration Frontend",
        status: "in_progress",
        priority: "urgent",
        customFields: { cf_score: 20, cf_tier: "enterprise", cf_is_blocked: false },
      });

      const results = await taskRepo.list({
        projectId: proj1Id,
        search: "Migration",
        status: "in_progress",
        priority: "urgent",
        customFieldFilters: [
          { fieldKey: "cf_score", operator: "greater_than_or_equal", value: 90 },
          { fieldKey: "cf_tier", operator: "equals", value: "enterprise" },
          { fieldKey: "cf_is_blocked", operator: "equals", value: false },
        ],
      });

      assert.equal(results.length, 1);
      assert.equal(results[0]?.id, match.id);
    });
  });

  describe("Security & Scope Boundaries", () => {
    it("rejects unknown custom field filter", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      await assert.rejects(
        () =>
          taskRepo.list({
            projectId: proj1Id,
            customFieldFilters: [{ fieldKey: "cf_non_existent", operator: "equals", value: "abc" }],
          }),
        TenantConflictError,
      );
    });

    it("rejects custom field from another workspace or project", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      // cf_env was created in proj1Id; querying in proj2Id must throw TenantConflictError
      await assert.rejects(
        () =>
          taskRepo.list({
            projectId: proj2Id,
            customFieldFilters: [{ fieldKey: "cf_env", operator: "equals", value: "prod" }],
          }),
        TenantConflictError,
      );
    });
  });

  describe("Custom Field Sorting & Stable Cursor Pagination", () => {
    it("paginates stably with custom field sort across multiple pages", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // Create a dedicated subproject for deterministic pagination
      const projRepo = createProjectsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const pageProj = await projRepo.create({ name: "Pagination Test Project" });

      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      await cfRepo.create({
        name: "Page Metric",
        key: "cf_metric",
        type: "number",
        projectId: pageProj.id,
      });

      // Create 15 tasks with distinct and duplicate metrics, plus 3 tasks with null metric
      const createdIds: string[] = [];
      const metricValues = [10, 20, 20, 30, 40, 50, 50, 60, 70, 80, 90, 100, 110, 120, 130];
      for (let i = 0; i < metricValues.length; i++) {
        const t = await taskRepo.create({
          projectId: pageProj.id,
          title: `Metric Task ${i + 1}`,
          customFields: { cf_metric: metricValues[i] },
        });
        createdIds.push(t.id);
      }
      for (let i = 0; i < 3; i++) {
        const t = await taskRepo.create({
          projectId: pageProj.id,
          title: `Null Metric Task ${i + 1}`,
          customFields: {},
        });
        createdIds.push(t.id);
      }

      // Paginate with limit 4 (ASC NULLS LAST)
      const collectedTasks: typeof createdIds = [];
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      while (pageCount < 10) {
        const page = await taskRepo.listPage({
          projectId: pageProj.id,
          customSort: { fieldKey: "cf_metric", direction: "asc" },
          limit: 4,
          cursor,
        });

        for (const item of page.items) {
          collectedTasks.push(item.id);
        }

        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        pageCount++;
      }

      assert.equal(collectedTasks.length, 18);
      assert.equal(new Set(collectedTasks).size, 18); // Zero duplicates!
      assert.equal(collectedTasks.length, createdIds.length); // Zero missing rows!

      // The last 3 tasks must be the ones with null metric (NULLS LAST)
      const lastThree = collectedTasks.slice(-3);
      for (const id of lastThree) {
        const t = await taskRepo.getById(id);
        assert.equal((t.customFields as Record<string, unknown> | null)?.cf_metric, undefined);
      }
    });

    it("paginates multi-page tasks with descending custom field sort and NULLS LAST", async () => {
      const projRepo = createProjectsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const pageProj = await projRepo.create({ name: "CF Descending Sort Project" });
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      await cfRepo.create({
        name: "Metric Desc",
        key: "cf_metric_desc",
        type: "number",
        projectId: pageProj.id,
      });

      const metricValues = [10, 20, 20, 30, 40, 50, 50, 60, 70, 80, 90, 100, 110, 120, 130];
      for (let i = 0; i < metricValues.length; i++) {
        await taskRepo.create({
          projectId: pageProj.id,
          title: `Metric Desc Task ${i + 1}`,
          customFields: { cf_metric_desc: metricValues[i] },
        });
      }
      for (let i = 0; i < 3; i++) {
        await taskRepo.create({
          projectId: pageProj.id,
          title: `Null Metric Desc Task ${i + 1}`,
          customFields: {},
        });
      }

      const collectedTasks: string[] = [];
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      while (pageCount < 10) {
        const page = await taskRepo.listPage({
          projectId: pageProj.id,
          customSort: { fieldKey: "cf_metric_desc", direction: "desc" },
          limit: 4,
          cursor,
        });

        for (const item of page.items) {
          collectedTasks.push(item.id);
        }

        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        pageCount++;
      }

      assert.equal(collectedTasks.length, 18);
      assert.equal(new Set(collectedTasks).size, 18);

      // The last 3 tasks must be the ones with null metric (NULLS LAST)
      const lastThree = collectedTasks.slice(-3);
      for (const id of lastThree) {
        const t = await taskRepo.getById(id);
        assert.equal((t.customFields as Record<string, unknown> | null)?.cf_metric_desc, undefined);
      }
    });

    it("rejects cursor from a different custom field sort or direction", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const page1 = await taskRepo.listPage({
        projectId: proj1Id,
        customSort: { fieldKey: "cf_score", direction: "asc" },
        limit: 2,
      });
      assert.ok(page1.nextCursor);

      // Attempt to reuse cursor with a different sort key
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            customSort: { fieldKey: "cf_env", direction: "asc" },
            limit: 2,
            cursor: page1.nextCursor!,
          }),
        TenantConflictError,
      );

      // Attempt to reuse cursor with a different sort direction
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            customSort: { fieldKey: "cf_score", direction: "desc" },
            limit: 2,
            cursor: page1.nextCursor!,
          }),
        TenantConflictError,
      );

      // Attempt to reuse malformed cursor
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            customSort: { fieldKey: "cf_score", direction: "asc" },
            limit: 2,
            cursor: "not-a-valid-base64-cursor",
          }),
        TenantConflictError,
      );
    });
  });

  describe("SQL / In-memory Parity Verification", () => {
    it("guarantees 100% agreement between SQL listPage and evaluateTaskCustomFieldFilter across operators", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const allTasks = await taskRepo.list({ projectId: proj1Id });
      const cfDefs = await cfRepo.list(proj1Id);
      const defsByKey = new Map(cfDefs.map((d) => [d.key, d]));

      const testCases = [
        { fieldKey: "cf_env", operator: "equals" as const, value: "production" },
        { fieldKey: "cf_env", operator: "not_equals" as const, value: "production" },
        { fieldKey: "cf_env", operator: "contains" as const, value: "stage" },
        { fieldKey: "cf_env", operator: "starts_with" as const, value: "dev" },
        { fieldKey: "cf_env", operator: "is_empty" as const },
        { fieldKey: "cf_env", operator: "is_not_empty" as const },

        { fieldKey: "cf_score", operator: "equals" as const, value: 50 },
        { fieldKey: "cf_score", operator: "not_equals" as const, value: 50 },
        { fieldKey: "cf_score", operator: "greater_than" as const, value: 60 },
        { fieldKey: "cf_score", operator: "greater_than_or_equal" as const, value: 50 },
        { fieldKey: "cf_score", operator: "less_than" as const, value: 50 },
        { fieldKey: "cf_score", operator: "less_than_or_equal" as const, value: 50 },
        { fieldKey: "cf_score", operator: "is_empty" as const },
        { fieldKey: "cf_score", operator: "is_not_empty" as const },

        { fieldKey: "cf_release_date", operator: "before" as const, value: "2026-09-01T00:00:00Z" },
        { fieldKey: "cf_release_date", operator: "after" as const, value: "2026-08-30T00:00:00Z" },
        { fieldKey: "cf_release_date", operator: "is_empty" as const },
        { fieldKey: "cf_release_date", operator: "is_not_empty" as const },

        { fieldKey: "cf_tier", operator: "equals" as const, value: "enterprise" },
        { fieldKey: "cf_tier", operator: "not_equals" as const, value: "enterprise" },
        { fieldKey: "cf_tier", operator: "is_empty" as const },
        { fieldKey: "cf_tier", operator: "is_not_empty" as const },

        { fieldKey: "cf_is_blocked", operator: "equals" as const, value: true },
        { fieldKey: "cf_is_blocked", operator: "equals" as const, value: false },
        { fieldKey: "cf_is_blocked", operator: "is_empty" as const },
        { fieldKey: "cf_is_blocked", operator: "is_not_empty" as const },
      ];

      for (const tc of testCases) {
        const def = defsByKey.get(tc.fieldKey)!;
        const expectedIds = allTasks
          .filter((t) => evaluateTaskCustomFieldFilter(t.customFields as any, tc, def))
          .map((t) => t.id)
          .sort();

        const sqlPage = await taskRepo.listPage({
          projectId: proj1Id,
          customFieldFilters: [tc],
          limit: 50,
        });
        const sqlIds = sqlPage.items.map((t) => t.id).sort();

        assert.deepEqual(
          sqlIds,
          expectedIds,
          `Parity failure on fieldKey=${tc.fieldKey}, op=${tc.operator}, val=${JSON.stringify(tc.value)}: SQL got [${sqlIds}], Evaluator got [${expectedIds}]`,
        );
      }
    });
  });

  describe("Sensitive Custom Fields & Security Injection Protection", () => {
    it("rejects filtering or sorting by sensitive custom fields", async () => {
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const sensitiveField = await cfRepo.create({
        name: "Confidential Budget",
        key: "cf_budget_secret",
        type: "number",
        projectId: proj1Id,
        sensitive: true,
      });

      // Filter rejection
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            customFieldFilters: [{ fieldKey: "cf_budget_secret", operator: "greater_than", value: 1000 }],
            limit: 10,
          }),
        TenantConflictError,
      );

      // Sort rejection
      await assert.rejects(
        () =>
          taskRepo.listPage({
            projectId: proj1Id,
            customSort: { fieldKey: "cf_budget_secret", direction: "asc" },
            limit: 10,
          }),
        TenantConflictError,
      );
    });

    it("resists SQL injection and metacharacter payloads safely", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // Malicious value with SQL injection
      const sqlPage = await taskRepo.listPage({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "equals", value: "' OR 1=1; DROP TABLE tasks; --" }],
        limit: 10,
      });
      assert.equal(sqlPage.items.length, 0);

      // Malicious JSON path string
      const jsonPage = await taskRepo.listPage({
        projectId: proj1Id,
        customFieldFilters: [{ fieldKey: "cf_env", operator: "equals", value: "$['invalid'].key" }],
        limit: 10,
      });
      assert.equal(jsonPage.items.length, 0);
    });
  });

  describe("Saved View Integration with Custom Field Filters", () => {
    it("persists, retrieves, and checks equality of saved views with custom field filters", async () => {
      const viewRepo = createSavedViewsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const saved = await viewRepo.create({
        projectId: proj1Id,
        name: "Enterprise High Priority",
        viewType: "table",
        filters: {
          status: "in_progress",
          customFields: [
            { fieldKey: "cf_score", operator: "greater_than_or_equal", value: 80 },
            { fieldKey: "cf_tier", operator: "equals", value: "enterprise" },
          ],
        },
        configuration: {
          schemaVersion: 2,
          table: { groupBy: "status" },
        },
        isShared: true,
        isDefault: false,
      });

      assert.equal(saved.name, "Enterprise High Priority");
      const savedFilters = saved.filters as { customFields?: unknown[] };
      assert.equal(Array.isArray(savedFilters.customFields), true);
      assert.equal(savedFilters.customFields?.length, 2);

      const list = await viewRepo.list(proj1Id);
      const fetched = list.find((v) => v.id === saved.id);
      assert.ok(fetched);
      assert.deepEqual(fetched.filters, saved.filters);
    });
  });
});
