import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import {
  memberships,
  projects,
  projectMembers,
  projectSections,
  projectTeams,
  projectWipLimits,
  tasks,
  teams,
  workspaces,
} from "../schema.js";
import { allocateTaskSerialNumbers, formatTaskSerial } from "../task-serials.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type ProjectRecord = typeof projects.$inferSelect;
export type ProjectStatus = ProjectRecord["status"];
export type ProjectPriority = ProjectRecord["priority"];
export type ProjectTemplate = "default" | "scrum" | "marketing" | "roadmap" | "bugs";
export type ProjectPrivacy = "workspace" | "private" | "private-members" | "guest-share" | "archived";

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  coverUrl?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  ownerId?: string | null;
  managerId?: string | null;
  memberIds?: string[];
  teamIds?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  privacy?: ProjectPrivacy;
  template?: ProjectTemplate;
  progress?: number;
  budget?: number | null;
  estimatedHours?: number | null;
  loggedHours?: number;
};

export type UpdateProjectInput = Partial<
  Pick<
    ProjectRecord,
    | "name"
    | "description"
    | "color"
    | "icon"
    | "coverUrl"
    | "status"
    | "priority"
    | "ownerId"
    | "managerId"
    | "startDate"
    | "endDate"
    | "privacy"
    | "progress"
    | "budget"
    | "estimatedHours"
  >
>;

type SectionTemplate = {
  name: string;
  order: number;
  color: string;
};

type SampleTask = {
  title: string;
  sectionIndex: number;
  priority: ProjectPriority;
  storyPoints: number;
  tags: string[];
};

const defaultSections: SectionTemplate[] = [
  { name: "Backlog", order: 0, color: "#64748b" },
  { name: "To Do", order: 1, color: "#6366f1" },
  { name: "In Progress", order: 2, color: "#f59e0b" },
  { name: "Done", order: 3, color: "#10b981" },
];

const sectionsByTemplate: Record<ProjectTemplate, SectionTemplate[]> = {
  default: defaultSections,
  scrum: [
    { name: "Sprint Backlog", order: 0, color: "#64748b" },
    { name: "In Development", order: 1, color: "#6366f1" },
    { name: "Code Review & QA", order: 2, color: "#06b6d4" },
    { name: "Ready for Release", order: 3, color: "#10b981" },
  ],
  marketing: [
    { name: "أفكار وحملات (Ideas)", order: 0, color: "#8b5cf6" },
    { name: "صناعة المحتوى (Content Prep)", order: 1, color: "#f59e0b" },
    { name: "مراجعة وتدقيق (Review)", order: 2, color: "#06b6d4" },
    { name: "منشور ومكتمل (Published)", order: 3, color: "#10b981" },
  ],
  roadmap: [
    { name: "الربع الأول Q1", order: 0, color: "#6366f1" },
    { name: "الربع الثاني Q2", order: 1, color: "#0ea5e9" },
    { name: "الربع الثالث Q3", order: 2, color: "#f59e0b" },
    { name: "الربع الرابع Q4", order: 3, color: "#10b981" },
  ],
  bugs: [
    { name: "تم الإبلاغ (Reported)", order: 0, color: "#ef4444" },
    { name: "جاري التحقيق (Investigating)", order: 1, color: "#f59e0b" },
    { name: "جاري الحل (Fixing)", order: 2, color: "#6366f1" },
    { name: "مغلق (Resolved)", order: 3, color: "#10b981" },
  ],
};

const sampleTasksByTemplate: Partial<Record<ProjectTemplate, SampleTask[]>> = {
  scrum: [
    {
      title: "إعداد بيئة CI/CD مع التنبيهات الآلية",
      sectionIndex: 0,
      priority: "high",
      storyPoints: 5,
      tags: ["devops", "ci"],
    },
    {
      title: "تطوير واجهة برمجة تطبيقات المستخدم مع JWT",
      sectionIndex: 1,
      priority: "urgent",
      storyPoints: 8,
      tags: ["backend", "api"],
    },
    {
      title: "كتابة اختبارات الوحدة E2E لشاشة الدخول",
      sectionIndex: 2,
      priority: "medium",
      storyPoints: 3,
      tags: ["testing", "qa"],
    },
  ],
  marketing: [
    {
      title: "تجهيز خطة المحتوى للربع الرابع على تيك توك ولينكدإن",
      sectionIndex: 0,
      priority: "high",
      storyPoints: 5,
      tags: ["social", "strategy"],
    },
    {
      title: "تصميم البنرات الإعلانية لحملة التخفيضات",
      sectionIndex: 1,
      priority: "urgent",
      storyPoints: 5,
      tags: ["design", "ads"],
    },
    {
      title: "مراجعة نصوص البريد الإلكتروني الإعلاني مع الإدارة",
      sectionIndex: 2,
      priority: "medium",
      storyPoints: 2,
      tags: ["email", "copy"],
    },
  ],
  roadmap: [
    {
      title: "إطلاق لوحة التحكم التفاعلية ومنشئ التقارير v2",
      sectionIndex: 0,
      priority: "urgent",
      storyPoints: 13,
      tags: ["release", "q1"],
    },
    {
      title: "تكامل المصادقة البيومترية ومفاتيح المرور Passkeys",
      sectionIndex: 1,
      priority: "high",
      storyPoints: 8,
      tags: ["security", "q2"],
    },
    {
      title: "توسيع محولات الدفع والتكامل مع الأنظمة المالية المحلية",
      sectionIndex: 2,
      priority: "medium",
      storyPoints: 5,
      tags: ["billing", "q3"],
    },
  ],
  bugs: [
    {
      title: "خطأ في تحميل المرفقات ذات الحجم الكبير > 50MB",
      sectionIndex: 0,
      priority: "urgent",
      storyPoints: 5,
      tags: ["bug", "storage"],
    },
    {
      title: "تأخر طفيف في استجابة استعلامات فلاتر الجدول الزمني",
      sectionIndex: 1,
      priority: "high",
      storyPoints: 3,
      tags: ["perf", "db"],
    },
    {
      title: "تحسين التباين اللوني في شاشات الجوال بالوضع الداكن",
      sectionIndex: 2,
      priority: "low",
      storyPoints: 2,
      tags: ["ui", "mobile"],
    },
  ],
};

export function createProjectsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  const tenantScope = and(
    eq(projects.organizationId, organizationId),
    eq(projects.workspaceId, workspaceId),
    isNull(projects.deletedAt),
  )!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) {
      throw new TenantResourceNotFoundError("workspace");
    }
  }

  async function requireMembers(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    if (!uniqueUserIds.length) return;
    const memberRows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          inArray(memberships.userId, uniqueUserIds),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      );
    if (new Set(memberRows.map((member) => member.userId)).size !== uniqueUserIds.length) {
      throw new TenantResourceNotFoundError("project member");
    }
  }

  async function requireTeams(teamIds: string[]) {
    const uniqueTeamIds = [...new Set(teamIds)];
    if (!uniqueTeamIds.length) return;
    const teamRows = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          inArray(teams.id, uniqueTeamIds),
          eq(teams.organizationId, organizationId),
          eq(teams.workspaceId, workspaceId),
          isNull(teams.deletedAt),
        ),
      );
    if (teamRows.length !== uniqueTeamIds.length) throw new TenantResourceNotFoundError("project team");
  }

  async function performUpdate(
    projectId: string,
    expectedVersion: number,
    input: UpdateProjectInput,
    options: { allowArchivedTransition?: boolean; requiredStatus?: ProjectStatus } = {},
  ) {
    await requireWorkspace();
    await requireMembers([input.ownerId, input.managerId].filter(Boolean) as string[]);
    const [existing] = await db
      .select({ status: projects.status, version: projects.version })
      .from(projects)
      .where(and(eq(projects.id, projectId), tenantScope))
      .limit(1);
    if (!existing) throw new TenantResourceNotFoundError("project");
    if (existing.version !== expectedVersion) throw new TenantConflictError("Project version is stale");
    if (options.requiredStatus && existing.status !== options.requiredStatus) {
      throw new TenantConflictError(`Project must be ${options.requiredStatus} for this operation`);
    }
    if (
      !options.allowArchivedTransition &&
      input.status !== undefined &&
      (existing.status === "archived" || input.status === "archived")
    ) {
      throw new TenantConflictError("Archive and restore must use their dedicated project operations");
    }
    const [project] = await db
      .update(projects)
      .set({ ...input, version: sql`${projects.version} + 1`, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), tenantScope, eq(projects.version, expectedVersion)))
      .returning();
    if (!project) throw new TenantConflictError("Project version is stale");
    return project;
  }

  return {
    async list() {
      await requireWorkspace();
      const rows = await db.select().from(projects).where(tenantScope).orderBy(desc(projects.createdAt));
      if (!rows.length) return [];
      const projectIds = rows.map((project) => project.id);
      const [limits, taskSummaries, memberSummaries] = await Promise.all([
        db
          .select()
          .from(projectWipLimits)
          .where(
            and(
              eq(projectWipLimits.organizationId, organizationId),
              eq(projectWipLimits.workspaceId, workspaceId),
              inArray(projectWipLimits.projectId, projectIds),
            ),
          ),
        db
          .select({
            projectId: tasks.projectId,
            totalTasks: count(),
            completedTasks: sql<number>`count(*) filter (where ${tasks.status} = 'done')`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.workspaceId, workspaceId),
              inArray(tasks.projectId, projectIds),
              isNull(tasks.deletedAt),
            ),
          )
          .groupBy(tasks.projectId),
        db
          .select({ projectId: projectMembers.projectId, memberCount: count() })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.organizationId, organizationId),
              eq(projectMembers.workspaceId, workspaceId),
              inArray(projectMembers.projectId, projectIds),
              isNull(projectMembers.deletedAt),
            ),
          )
          .groupBy(projectMembers.projectId),
      ]);
      const taskSummaryByProject = new Map(taskSummaries.map((summary) => [summary.projectId, summary]));
      const memberCountByProject = new Map(
        memberSummaries.map((summary) => [summary.projectId, Number(summary.memberCount)]),
      );
      return rows.map((project) => ({
        ...project,
        totalTasks: Number(taskSummaryByProject.get(project.id)?.totalTasks ?? 0),
        completedTasks: Number(taskSummaryByProject.get(project.id)?.completedTasks ?? 0),
        memberCount: memberCountByProject.get(project.id) ?? 0,
        wipLimits: Object.fromEntries(
          limits.filter((limit) => limit.projectId === project.id).map((limit) => [limit.status, limit.limit]),
        ),
      }));
    },

    async getById(projectId: string, includeDeleted = false) {
      await requireWorkspace();
      const conditions = [
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        eq(projects.workspaceId, workspaceId),
      ];
      if (!includeDeleted) {
        conditions.push(isNull(projects.deletedAt));
      }
      const [project] = await db
        .select()
        .from(projects)
        .where(and(...conditions))
        .limit(1);
      if (!project) {
        throw new TenantResourceNotFoundError("project");
      }
      return project;
    },

    async create(input: CreateProjectInput) {
      await requireWorkspace();
      const memberIds = [
        ...new Set([...(input.memberIds ?? []), input.ownerId, input.managerId].filter(Boolean)),
      ] as string[];
      const teamIds = [...new Set(input.teamIds ?? [])];
      await requireMembers(memberIds);
      await requireTeams(teamIds);

      const template = input.template ?? "default";
      const sectionTemplates = sectionsByTemplate[template];
      const sampleTasks = sampleTasksByTemplate[template] ?? [];
      const sampleTaskSerials = sampleTasks.length
        ? await allocateTaskSerialNumbers(organizationId, sampleTasks.length)
        : [];

      return db.transaction(async (transaction) => {
        const [project] = await transaction
          .insert(projects)
          .values({
            organizationId,
            workspaceId,
            name: input.name,
            description: input.description ?? null,
            color: input.color ?? "#6366f1",
            icon: input.icon ?? "folder",
            coverUrl: input.coverUrl ?? null,
            status: input.status ?? "active",
            priority: input.priority ?? "medium",
            ownerId: input.ownerId ?? null,
            managerId: input.managerId ?? null,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            privacy: input.privacy ?? "workspace",
            template,
            progress: input.progress ?? 0,
            budget: input.budget ?? null,
            estimatedHours: input.estimatedHours ?? null,
            loggedHours: input.loggedHours ?? 0,
          })
          .returning();

        if (memberIds.length) {
          await transaction
            .insert(projectMembers)
            .values(
              memberIds.map((userId) => ({
                organizationId,
                workspaceId,
                projectId: project.id,
                userId,
                role:
                  userId === input.ownerId
                    ? ("manager" as const)
                    : userId === input.managerId
                      ? ("manager" as const)
                      : ("member" as const),
                isOwner: userId === input.ownerId,
                addedBy: context.actorId ?? null,
              })),
            )
            .onConflictDoNothing();
        }

        if (teamIds.length) {
          await transaction.insert(projectTeams).values(
            teamIds.map((teamId) => ({
              organizationId,
              workspaceId,
              projectId: project.id,
              teamId,
              addedBy: context.actorId ?? null,
            })),
          );
        }

        const createdSections = await transaction
          .insert(projectSections)
          .values(
            sectionTemplates.map((section) => ({
              organizationId,
              workspaceId,
              projectId: project.id,
              name: section.name,
              order: section.order,
              color: section.color,
            })),
          )
          .returning();

        if (sampleTasks.length) {
          await transaction.insert(tasks).values(
            sampleTasks.map((sampleTask, index) => ({
              organizationId,
              workspaceId,
              projectId: project.id,
              sectionId: createdSections[sampleTask.sectionIndex]?.id ?? null,
              serial: formatTaskSerial(sampleTaskSerials[index]!),
              title: sampleTask.title,
              description: `تم إنشاؤه تلقائيا كجزء من قالب مشروع (${template}). يمكنك تعديله أو حذفه.`,
              status:
                sampleTask.sectionIndex === 0
                  ? ("todo" as const)
                  : sampleTask.sectionIndex === 1
                    ? ("in_progress" as const)
                    : ("review" as const),
              priority: sampleTask.priority,
              storyPoints: sampleTask.storyPoints,
              tags: sampleTask.tags,
              order: index,
              progress: sampleTask.sectionIndex === 1 ? 40 : sampleTask.sectionIndex === 2 ? 80 : 0,
            })),
          );
        }

        return project;
      });
    },

    async update(projectId: string, expectedVersion: number, input: UpdateProjectInput) {
      return performUpdate(projectId, expectedVersion, input);
    },

    async archive(projectId: string, expectedVersion: number) {
      return performUpdate(projectId, expectedVersion, { status: "archived" }, { allowArchivedTransition: true });
    },

    async restore(projectId: string, expectedVersion: number) {
      return performUpdate(
        projectId,
        expectedVersion,
        { status: "active" },
        { allowArchivedTransition: true, requiredStatus: "archived" },
      );
    },

    async softDelete(projectId: string, expectedVersion: number) {
      await requireWorkspace();
      const [project] = await db
        .update(projects)
        .set({ deletedAt: new Date(), version: sql`${projects.version} + 1`, updatedAt: new Date() })
        .where(and(eq(projects.id, projectId), tenantScope, eq(projects.version, expectedVersion)))
        .returning();
      if (project) return project;
      const [existing] = await db
        .select({ version: projects.version })
        .from(projects)
        .where(and(eq(projects.id, projectId), tenantScope))
        .limit(1);
      if (!existing) throw new TenantResourceNotFoundError("project");
      throw new TenantConflictError("Project version is stale");
    },
  };
}
