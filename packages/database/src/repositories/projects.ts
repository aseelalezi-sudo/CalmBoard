import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
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

  return {
    async list() {
      await requireWorkspace();
      const rows = await db.select().from(projects).where(tenantScope).orderBy(desc(projects.createdAt));
      const limits = rows.length
        ? await db
            .select()
            .from(projectWipLimits)
            .where(
              and(
                eq(projectWipLimits.organizationId, organizationId),
                eq(projectWipLimits.workspaceId, workspaceId),
                inArray(
                  projectWipLimits.projectId,
                  rows.map((project) => project.id),
                ),
              ),
            )
        : [];
      return rows.map((project) => ({
        ...project,
        wipLimits: Object.fromEntries(
          limits.filter((limit) => limit.projectId === project.id).map((limit) => [limit.status, limit.limit]),
        ),
      }));
    },

    async getById(projectId: string) {
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), tenantScope))
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
  };
}
