import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  createTasksRepository,
  db,
  organizations,
  pool,
  projects,
  tasks,
  withTenantTransaction,
  workspaces,
} from "../src/index";
import { eq, sql } from "drizzle-orm";

after(async () => {
  await pool.end();
});

describe("task pagination at project scale", () => {
  it("keeps table and board pages bounded with 100,000 tasks", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Task pagination scale",
        slug: `task-scale-${organizationId}`,
        plan: "business",
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Scale workspace",
        slug: `task-scale-${workspaceId}`,
      });
      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "100k task project",
      });

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
          'LOAD-' || lpad(sequence::text, 6, '0'),
          'Load task ' || lpad(sequence::text, 6, '0'),
          (
            case sequence % 5
              when 0 then 'backlog'
              when 1 then 'todo'
              when 2 then 'in_progress'
              when 3 then 'review'
              else 'done'
            end
          )::task_status,
          'medium'::task_priority,
          sequence::double precision,
          timestamptz '2026-01-01 00:00:00+00' + sequence * interval '1 millisecond',
          timestamptz '2026-01-01 00:00:00+00' + sequence * interval '1 millisecond'
        from generate_series(1, 100000) as generated(sequence)
      `);

      await withTenantTransaction({ organizationId, workspaceId }, async () => {
        const repository = createTasksRepository({ organizationId, workspaceId });
        const startedAt = performance.now();
        const firstTablePage = await repository.listPage({
          projectId,
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
        });
        const secondTablePage = await repository.listPage({
          projectId,
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
          cursor: firstTablePage.nextCursor!,
        });
        const todoBoardPage = await repository.listPage({
          projectId,
          status: "todo",
          limit: 50,
          sortBy: "order",
          sortDirection: "asc",
        });
        const elapsedMs = performance.now() - startedAt;

        assert.equal(firstTablePage.items.length, 100);
        assert.equal(firstTablePage.total, 100_000);
        assert.ok(firstTablePage.nextCursor);
        assert.equal(secondTablePage.items.length, 100);
        assert.equal(secondTablePage.total, 100_000);
        assert.equal(
          firstTablePage.items.some((first) => secondTablePage.items.some((second) => first.id === second.id)),
          false,
        );
        assert.ok(firstTablePage.items[0]!.createdAt > firstTablePage.items[99]!.createdAt);
        assert.equal(todoBoardPage.items.length, 50);
        assert.equal(todoBoardPage.total, 20_000);
        assert.ok(todoBoardPage.nextCursor);
        assert.ok(todoBoardPage.items[0]!.order < todoBoardPage.items[49]!.order);
        assert.ok(JSON.stringify(firstTablePage).length < 500_000);
        assert.ok(elapsedMs < 5_000, `Expected bounded pages in under 5 seconds, received ${elapsedMs.toFixed(0)}ms`);
        console.log(`Loaded two table pages and one board page across 100,000 tasks in ${elapsedMs.toFixed(0)}ms.`);
      });
    } finally {
      await db.delete(tasks).where(eq(tasks.organizationId, organizationId));
      await db.delete(projects).where(eq(projects.organizationId, organizationId));
      await db.delete(workspaces).where(eq(workspaces.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});
