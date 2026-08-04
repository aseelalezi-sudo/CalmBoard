import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  attachments,
  comments,
  createSearchRepository,
  db,
  docs,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  teams,
  users,
  withTenantTransaction,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("PostgreSQL workspace search", () => {
  it("searches every supported entity with ranking, typo tolerance, permissions, and tenant isolation", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    const hiddenAuthorId = randomUUID();
    const projectId = randomUUID();
    const exactBudgetTaskId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const otherProjectId = randomUUID();
    const otherActorId = randomUUID();
    const createdUserIds = [actorId, hiddenAuthorId, otherActorId];

    try {
      await db.insert(users).values([
        {
          id: actorId,
          email: `atlas-${actorId}@example.com`,
          name: "Atlas Member",
          passwordHash: "must-never-appear-in-search",
        },
        { id: hiddenAuthorId, email: `${hiddenAuthorId}@example.com`, name: "Hidden author" },
        { id: otherActorId, email: `${otherActorId}@example.com`, name: "Other tenant owner" },
      ]);
      await db.insert(organizations).values([
        { id: organizationId, ownerId: actorId, name: "Atlas organization", slug: `atlas-${organizationId}` },
        {
          id: otherOrganizationId,
          ownerId: otherActorId,
          name: "Other organization",
          slug: `other-${otherOrganizationId}`,
        },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Atlas workspace", slug: `atlas-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId: otherOrganizationId,
          name: "Other workspace",
          slug: `other-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: actorId, role: "owner" },
        { organizationId, workspaceId, userId: hiddenAuthorId, role: "member" },
        { organizationId: otherOrganizationId, workspaceId: otherWorkspaceId, userId: otherActorId, role: "owner" },
      ]);
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "Atlas project", description: "Quarterly delivery" },
        {
          id: otherProjectId,
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          name: "Atlas secret project",
        },
      ]);
      await db.insert(teams).values({
        organizationId,
        workspaceId,
        name: "Atlas team",
        description: "Search platform maintainers",
      });
      const [atlasTask] = await db
        .insert(tasks)
        .values({
          organizationId,
          workspaceId,
          projectId,
          serial: "ATL-1",
          title: "Atlas task",
          description: "Visible workspace task",
        })
        .returning({ id: tasks.id });
      await db.insert(tasks).values([
        {
          id: exactBudgetTaskId,
          organizationId,
          workspaceId,
          projectId,
          serial: "ATL-2",
          title: "Budget",
        },
        {
          organizationId,
          workspaceId,
          projectId,
          serial: "ATL-3",
          title: "Budget planning guide",
        },
        {
          organizationId,
          workspaceId,
          projectId,
          serial: "ATL-4",
          title: "Atlas deleted task",
          deletedAt: new Date(),
        },
        {
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          projectId: otherProjectId,
          serial: "OTH-1",
          title: "Atlas secret task",
        },
      ]);
      await db.insert(comments).values({
        organizationId,
        workspaceId,
        taskId: atlasTask!.id,
        userId: actorId,
        content: "Atlas comment",
      });
      await db.insert(attachments).values({
        organizationId,
        workspaceId,
        taskId: atlasTask!.id,
        uploaderId: actorId,
        fileName: "atlas-report.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
        url: "objects/atlas-report.pdf",
        scanStatus: "clean",
      });
      await db.insert(docs).values([
        {
          organizationId,
          workspaceId,
          projectId,
          authorId: actorId,
          title: "Atlas handbook",
          content: "Workspace search documentation",
          workspaceAccess: "viewer",
        },
        {
          organizationId,
          workspaceId,
          projectId,
          authorId: hiddenAuthorId,
          title: "Atlas private acquisition",
          content: "Must remain invisible",
          workspaceAccess: "none",
          isPublic: false,
        },
      ]);

      const atlasResults = await withTenantTransaction({ organizationId, workspaceId, actorId }, () =>
        createSearchRepository({ organizationId, workspaceId, actorId }).search("Atlas"),
      );
      assert.ok(atlasResults.tasks.some((task) => task.title === "Atlas task"));
      assert.ok(atlasResults.projects.some((project) => project.name === "Atlas project"));
      assert.deepEqual(
        atlasResults.docs.map((document) => document.title),
        ["Atlas handbook"],
      );
      assert.ok(atlasResults.comments.some((comment) => comment.content === "Atlas comment"));
      assert.ok(atlasResults.teams.some((team) => team.name === "Atlas team"));
      assert.ok(atlasResults.attachments.some((attachment) => attachment.fileName === "atlas-report.pdf"));
      assert.ok(atlasResults.users.some((user) => user.name === "Atlas Member"));
      assert.equal("passwordHash" in atlasResults.users[0]!, false);
      assert.equal(
        atlasResults.tasks.some((task) => task.title.includes("secret")),
        false,
      );
      assert.equal(
        atlasResults.tasks.some((task) => task.title.includes("deleted")),
        false,
      );

      const exactResults = await withTenantTransaction({ organizationId, workspaceId, actorId }, () =>
        createSearchRepository({ organizationId, workspaceId, actorId }).search("Budget"),
      );
      assert.equal(exactResults.tasks[0]?.id, exactBudgetTaskId);

      const typoResults = await withTenantTransaction({ organizationId, workspaceId, actorId }, () =>
        createSearchRepository({ organizationId, workspaceId, actorId }).search("Budegt"),
      );
      assert.ok(typoResults.tasks.some((task) => task.id === exactBudgetTaskId));

      const extension = await pool.query<{ installed: boolean }>(
        "select exists(select 1 from pg_extension where extname = 'pg_trgm') as installed",
      );
      assert.equal(extension.rows[0]?.installed, true);

      const requiredIndexes = [
        "tasks_search_fts_idx",
        "tasks_search_trgm_idx",
        "projects_search_fts_idx",
        "projects_search_trgm_idx",
        "docs_search_fts_idx",
        "docs_search_trgm_idx",
        "comments_search_fts_idx",
        "comments_search_trgm_idx",
        "teams_search_fts_idx",
        "teams_search_trgm_idx",
        "attachments_search_fts_idx",
        "attachments_search_trgm_idx",
        "users_search_fts_idx",
        "users_search_trgm_idx",
      ];
      const installedIndexes = await pool.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])",
        [requiredIndexes],
      );
      assert.deepEqual(new Set(installedIndexes.rows.map((row) => row.indexname)), new Set(requiredIndexes));

      await db.execute(sql`
        insert into tasks (
          id,
          organization_id,
          workspace_id,
          project_id,
          serial,
          title,
          status,
          priority,
          "order",
          created_at,
          updated_at
        )
        select
          gen_random_uuid(),
          ${organizationId}::uuid,
          ${workspaceId}::uuid,
          ${projectId}::uuid,
          'IDX-' || sequence,
          'Search index filler ' || sequence,
          'todo'::task_status,
          'medium'::task_priority,
          sequence::double precision,
          current_timestamp,
          current_timestamp
        from generate_series(1, 2000) as generated(sequence)
      `);
      await pool.query("analyze public.tasks");
      await pool.query("set enable_seqscan = off");
      const plan = await pool.query<{ "QUERY PLAN": string }>(`
        explain
        select id
        from public.tasks
        where deleted_at is null
          and to_tsvector(
            'simple'::regconfig,
            coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(serial, '')
          ) @@ websearch_to_tsquery('simple'::regconfig, 'Atlas')
      `);
      assert.match(plan.rows.map((row) => row["QUERY PLAN"]).join("\n"), /tasks_search_fts_idx/);
    } finally {
      await pool.query("reset enable_seqscan").catch(() => undefined);
      await db.delete(attachments).where(inArray(attachments.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(comments).where(inArray(comments.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(docs).where(inArray(docs.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(tasks).where(inArray(tasks.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(teams).where(inArray(teams.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(projects).where(inArray(projects.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(memberships).where(inArray(memberships.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(workspaces).where(inArray(workspaces.organizationId, [organizationId, otherOrganizationId]));
      await db.delete(organizations).where(inArray(organizations.id, [organizationId, otherOrganizationId]));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });
});
