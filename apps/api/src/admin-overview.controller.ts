import { Controller, Get } from "@nestjs/common";
import {
  activities,
  automations,
  db,
  docs,
  forms,
  goals,
  invoices,
  organizations,
  projects,
  tasks,
  timeLogs,
  users,
  workspaces,
} from "@calmboard/database";
import { PlatformAdmin } from "./platform-admin.guard.js";

async function count<T>(query: Promise<T[]>) {
  try {
    return (await query).length;
  } catch {
    return 0;
  }
}

@Controller("admin/overview")
@PlatformAdmin()
export class AdminOverviewController {
  @Get()
  async overview() {
    const userCount = await count(db.select().from(users));
    const organizationCount = await count(db.select().from(organizations));
    const workspaceCount = await count(db.select().from(workspaces));
    const projectCount = await count(db.select().from(projects));
    const taskCount = await count(db.select().from(tasks));
    const docCount = await count(db.select().from(docs));
    const goalCount = await count(db.select().from(goals));
    const automationCount = await count(db.select().from(automations));
    const formCount = await count(db.select().from(forms));
    const timeLogCount = await count(db.select().from(timeLogs));
    const activityCount = await count(db.select().from(activities));
    const invoiceCount = await count(db.select().from(invoices));
    const organizationRows = await db
      .select()
      .from(organizations)
      .catch(() => []);
    return {
      counts: {
        users: userCount,
        organizations: organizationCount,
        workspaces: workspaceCount,
        projects: projectCount,
        tasks: taskCount,
        docs: docCount,
        goals: goalCount,
        automations: automationCount,
        forms: formCount,
        timeLogs: timeLogCount,
        activities: activityCount,
        invoices: invoiceCount,
      },
      organizations: organizationRows,
    };
  }
}
