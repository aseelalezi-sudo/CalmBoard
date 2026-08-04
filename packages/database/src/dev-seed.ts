import { db } from "./client.js";
import * as schema from "./schema.js";
import { eq } from "drizzle-orm";
import { allocateTaskSerialNumbers, formatTaskSerial, synchronizeTaskSerialSequence } from "./task-serials.js";

/**
 * Adds newer entities (subtasks, saved views, time logs, activity, automation rules with
 * executable actions) to databases that were seeded before those features existed.
 * Safe to call repeatedly — every block checks for existing rows first.
 */
async function ensureExtras() {
  const added: string[] = [];

  const organizationRows = await db.select().from(schema.organizations);
  const workspaceRows = await db.select().from(schema.workspaces);
  const allUserRows = await db.select().from(schema.users);
  const projectRows = await db.select().from(schema.projects);
  const membershipRows = await db.select().from(schema.memberships);
  const allTasks = await db.select().from(schema.tasks);
  const project = projectRows.find((candidate) =>
    membershipRows.some(
      (membership) =>
        membership.organizationId === candidate.organizationId &&
        membership.status === "active" &&
        (membership.workspaceId === null || membership.workspaceId === candidate.workspaceId),
    ),
  );
  if (!project) return added;

  const org = organizationRows.find((candidate) => candidate.id === project.organizationId);
  const ws = workspaceRows.find((candidate) => candidate.id === project.workspaceId);
  const activeUserIds = new Set(
    membershipRows
      .filter(
        (membership) =>
          membership.organizationId === project.organizationId &&
          membership.status === "active" &&
          (membership.workspaceId === null || membership.workspaceId === project.workspaceId),
      )
      .map((membership) => membership.userId),
  );
  const userRows = allUserRows.filter((user) => activeUserIds.has(user.id));
  const owner = allUserRows.find((user) => user.id === org?.ownerId && activeUserIds.has(user.id)) ?? userRows[0];
  if (!org || !ws || !owner || userRows.length === 0) return added;

  const scopedTasks = allTasks.filter(
    (task) =>
      task.organizationId === project.organizationId &&
      task.workspaceId === project.workspaceId &&
      task.projectId === project.id,
  );

  // Executable automation rules (older seed stored non-actionable payloads).
  const existingAutomations = await db.select().from(schema.automations);
  const hasExecutable = existingAutomations.some((a) => a.actions && (a.actions as Record<string, unknown>).setStatus);
  if (!hasExecutable) {
    await db.insert(schema.automations).values([
      {
        organizationId: org.id,
        workspaceId: ws.id,
        name: "المهام العاجلة تنتقل تلقائياً إلى قيد التنفيذ",
        trigger: "task_created",
        conditions: { priority: "urgent" },
        actions: { setStatus: "in_progress", notify: "assignee", notifyTitle: "مهمة عاجلة تحتاج انتباهك" },
        enabled: true,
      },
      {
        organizationId: org.id,
        workspaceId: ws.id,
        name: "عند اكتمال المهمة أضف وسم مُراجع وأبلغ المُبلِّغ",
        trigger: "task_status_changed",
        conditions: { status: "done" },
        actions: { addTag: "مكتمل", notify: "reporter", notifyTitle: "اكتملت مهمة تتابعها" },
        enabled: true,
      },
    ]);
    added.push("automations");
  }

  // Subtasks for the first two parent tasks.
  const hasSubtasks = scopedTasks.some((t) => t.parentId);
  if (!hasSubtasks) {
    const parents = scopedTasks.filter((t) => !t.parentId).slice(0, 2);
    await synchronizeTaskSerialSequence(org.id);
    const serialNumbers = parents.length > 0 ? await allocateTaskSerialNumbers(org.id, parents.length * 3) : [];
    let serialIndex = 0;
    for (const parent of parents) {
      const titles = ["تحليل المتطلبات ومراجعتها مع الفريق", "تنفيذ الجزء الأساسي", "كتابة الاختبارات والمراجعة"];
      for (let i = 0; i < titles.length; i++) {
        await db.insert(schema.tasks).values({
          organizationId: parent.organizationId,
          workspaceId: parent.workspaceId,
          projectId: parent.projectId,
          sectionId: parent.sectionId,
          parentId: parent.id,
          serial: formatTaskSerial(serialNumbers[serialIndex++]!),
          title: titles[i],
          status: i === 0 ? "done" : "todo",
          priority: "medium",
          assigneeId: userRows[(i + 1) % userRows.length].id,
          reporterId: owner.id,
          order: i,
          progress: i === 0 ? 100 : 0,
          estimatedHours: 3,
        });
      }
    }
    if (parents.length > 0) added.push("subtasks");
  }

  // Saved views.
  const existingViews = await db.select().from(schema.savedViews).limit(1);
  if (existingViews.length === 0) {
    await db.insert(schema.savedViews).values([
      {
        organizationId: org.id,
        workspaceId: ws.id,
        projectId: project.id,
        name: "المهام العاجلة",
        viewType: "board",
        filters: { priority: "urgent" },
        isShared: true,
        createdBy: owner.id,
      },
      {
        organizationId: org.id,
        workspaceId: ws.id,
        projectId: project.id,
        name: "مهامي قيد التنفيذ",
        viewType: "list",
        filters: { status: "in_progress" },
        isShared: false,
        createdBy: owner.id,
      },
      {
        organizationId: org.id,
        workspaceId: ws.id,
        projectId: project.id,
        name: "لوحة المراجعة",
        viewType: "board",
        filters: { status: "review" },
        isShared: true,
        createdBy: owner.id,
      },
    ]);
    added.push("savedViews");
  }

  // Time logs for the current week.
  const existingLogs = await db.select().from(schema.timeLogs).limit(1);
  if (existingLogs.length === 0) {
    const targets = scopedTasks.filter((t) => !t.parentId).slice(0, 5);
    for (let i = 0; i < targets.length; i++) {
      const minutes = [95, 140, 65, 180, 45][i] ?? 60;
      const startedAt = new Date(Date.now() - (i + 1) * 24 * 3600 * 1000);
      const periodStart = new Date(
        Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()),
      );
      periodStart.setUTCDate(
        periodStart.getUTCDate() - (periodStart.getUTCDay() === 0 ? 6 : periodStart.getUTCDay() - 1),
      );
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
      const userId = userRows[i % userRows.length].id;
      const periodKey = {
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
      };
      const [timesheet] = await db
        .insert(schema.timesheets)
        .values({
          organizationId: targets[i].organizationId,
          workspaceId: targets[i].workspaceId,
          userId,
          ...periodKey,
        })
        .onConflictDoUpdate({
          target: [
            schema.timesheets.organizationId,
            schema.timesheets.workspaceId,
            schema.timesheets.userId,
            schema.timesheets.periodStart,
            schema.timesheets.periodEnd,
          ],
          set: { updatedAt: new Date() },
        })
        .returning({ id: schema.timesheets.id });
      await db.insert(schema.timeLogs).values({
        organizationId: targets[i].organizationId,
        workspaceId: targets[i].workspaceId,
        timesheetId: timesheet.id,
        taskId: targets[i].id,
        userId,
        description: "عمل مركّز على المهمة",
        startedAt,
        endedAt: new Date(startedAt.getTime() + minutes * 60000),
        durationMinutes: minutes,
        billable: i % 3 !== 0,
      });
    }
    added.push("timeLogs");
  }

  // Invoices for billing.
  const existingInvoices = await db.select().from(schema.invoices).limit(1);
  if (existingInvoices.length === 0) {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const start = new Date(now - (i + 1) * 30 * 24 * 3600 * 1000);
      await db.insert(schema.invoices).values({
        organizationId: org.id,
        number: `INV-2025-${String(1042 - i)}`,
        amount: 25 * 16,
        currency: "USD",
        status: "paid",
        periodStart: start,
        periodEnd: new Date(start.getTime() + 30 * 24 * 3600 * 1000),
      });
    }
    added.push("invoices");
  }

  // A starter form that converts responses to tasks.
  const existingForms = await db.select().from(schema.forms).limit(1);
  if (existingForms.length === 0) {
    await db.insert(schema.forms).values({
      organizationId: org.id,
      workspaceId: ws.id,
      projectId: project.id,
      name: "طلب ميزة جديدة",
      description: "أرسل طلبك وسيُحوَّل تلقائياً إلى مهمة في المشروع",
      fields: [
        { id: "f1", type: "text", label: "عنوان الطلب", required: true },
        { id: "f2", type: "textarea", label: "التفاصيل", required: true },
        { id: "f3", type: "select", label: "الأولوية", options: ["منخفض", "متوسط", "عاجل"], required: false },
      ],
      settings: {
        schemaVersion: 1,
        createTask: true,
        status: "todo",
        priority: "medium",
        captchaEnabled: true,
        taskTitleFieldId: "f1",
        taskDescriptionFieldId: "f2",
      },
      responses: 0,
      isActive: true,
    });
    added.push("forms");
  }

  // Activity feed.
  const existingActivity = await db.select().from(schema.activities).limit(1);
  if (existingActivity.length === 0) {
    const targets = scopedTasks.filter((t) => !t.parentId).slice(0, 6);
    for (let i = 0; i < targets.length; i++) {
      await db.insert(schema.activities).values({
        organizationId: targets[i].organizationId,
        workspaceId: targets[i].workspaceId,
        actorId: userRows[i % userRows.length].id,
        action: i % 3 === 0 ? "task.created" : i % 3 === 1 ? "task.updated" : "comment.added",
        entityType: "task",
        entityId: targets[i].id,
        newValues: { status: targets[i].status },
        ip: "127.0.0.1",
      });
    }
    added.push("activities");
  }

  // Branches
  const existingBranches = await db.select().from(schema.branches).limit(1);
  if (existingBranches.length === 0) {
    await db.insert(schema.branches).values([
      {
        organizationId: org.id,
        name: "المقر الرئيسي - الرياض",
        code: "RYD-HQ",
        city: "الرياض",
        address: "طريق الملك فهد، برج الريادة",
      },
      {
        organizationId: org.id,
        name: "الفرع الإقليمي - دبي",
        code: "DXB-REG",
        city: "دبي",
        address: "مدينة دبي للإنترنت، مبنى 4",
      },
      {
        organizationId: org.id,
        name: "الفرع الإقليمي - القاهرة",
        code: "CAI-REG",
        city: "القاهرة",
        address: "المعادي، القرية الذكية",
      },
    ]);
    added.push("branches");
  }

  // User Sessions
  const existingSessions = await db.select().from(schema.userSessions).limit(1);
  if (existingSessions.length === 0) {
    for (const u of userRows) {
      await db.insert(schema.userSessions).values([
        {
          userId: u.id,
          device: "MacBook Pro M3 (macOS)",
          browser: "Chrome 126.0",
          ip: "192.168.1.10",
          location: "الرياض، السعودية",
          isCurrent: u.id === owner.id,
        },
        {
          userId: u.id,
          device: "iPhone 15 Pro (iOS)",
          browser: "Safari Mobile",
          ip: "172.20.10.2",
          location: "الرياض، السعودية",
          isCurrent: false,
        },
      ]);
    }
    added.push("userSessions");
  }

  // Doc Versions
  const existingDocVersions = await db.select().from(schema.docVersions).limit(1);
  if (existingDocVersions.length === 0) {
    const allDocs = (await db.select().from(schema.docs))
      .filter((doc) => doc.organizationId === org.id && doc.workspaceId === ws.id)
      .slice(0, 3);
    for (const d of allDocs) {
      await db.insert(schema.docVersions).values([
        {
          organizationId: d.organizationId,
          workspaceId: d.workspaceId,
          docId: d.id,
          title: `${d.title} (مسودة أولية)`,
          content: "# مسودة 1\nتم البدء بكتابة هذا المستند وتحديد النقاط الأساسية.",
          versionNumber: 1,
          savedById: owner.id,
        },
        {
          organizationId: d.organizationId,
          workspaceId: d.workspaceId,
          docId: d.id,
          title: `${d.title} (مراجعة الفريق)`,
          content: "# الإصدار 2\nتم إضافة ملاحظات الفريق وتعديل الهيكل العام.",
          versionNumber: 2,
          savedById: owner.id,
        },
      ]);
    }
    added.push("docVersions");
  }

  // Notification preferences
  const existingPrefs = await db.select().from(schema.notificationPreferences).limit(1);
  if (existingPrefs.length === 0) {
    for (const u of userRows) {
      await db.insert(schema.notificationPreferences).values({
        userId: u.id,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
        dndStart: "22:00",
        dndEnd: "07:00",
        dndEnabled: false,
      });
    }
    added.push("notificationPreferences");
  }

  await synchronizeTaskSerialSequence(org.id);
  return added;
}

export async function runDevelopmentSeed() {
  try {
    // Check if already seeded
    const existingUsers = await db.select().from(schema.users).limit(1);
    if (existingUsers.length > 0) {
      const extras = await ensureExtras();
      return { message: "Already seeded", seeded: true, extras };
    }

    // Create users
    const [owner] = await db
      .insert(schema.users)
      .values({
        email: "owner@calmboard.com",
        name: "نورا أحمد",
        avatarUrl: "https://i.pravatar.cc/150?u=owner",
        locale: "ar",
      })
      .returning();
    const [admin] = await db
      .insert(schema.users)
      .values({
        email: "admin@calmboard.com",
        name: "Alex Rivera",
        avatarUrl: "https://i.pravatar.cc/150?u=admin",
        locale: "en",
      })
      .returning();
    const [member1] = await db
      .insert(schema.users)
      .values({
        email: "sara@calmboard.com",
        name: "سارة الخالدي",
        avatarUrl: "https://i.pravatar.cc/150?u=sara",
      })
      .returning();
    const [member2] = await db
      .insert(schema.users)
      .values({
        email: "omar@calmboard.com",
        name: "عمر الحربي",
        avatarUrl: "https://i.pravatar.cc/150?u=omar",
      })
      .returning();
    const [guest] = await db
      .insert(schema.users)
      .values({
        email: "guest@calmboard.com",
        name: "Liam Chen",
        avatarUrl: "https://i.pravatar.cc/150?u=guest",
      })
      .returning();

    // Org
    const [org] = await db
      .insert(schema.organizations)
      .values({
        name: "شركة الريادة الرقمية",
        slug: "riyada",
        ownerId: owner.id,
        plan: "business",
        seats: 25,
        settings: { aiEnabled: true, locale: "ar" },
      })
      .returning();

    // Workspaces
    const [ws1] = await db
      .insert(schema.workspaces)
      .values({
        organizationId: org.id,
        name: "المنتج والتقنية",
        slug: "product-tech",
        color: "#7C3AED",
        icon: "code-2",
        description: "فريق تطوير المنتج والتقنية",
      })
      .returning();
    const [ws2] = await db
      .insert(schema.workspaces)
      .values({
        organizationId: org.id,
        name: "التسويق والمبيعات",
        slug: "marketing-sales",
        color: "#0EA5E9",
        icon: "megaphone",
        description: "Marketing & Sales workspace",
      })
      .returning();

    // Teams
    const [teamEng] = await db
      .insert(schema.teams)
      .values({
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "الهندسة",
        color: "#6366F1",
        description: "Engineering team",
      })
      .returning();
    const [teamDesign] = await db
      .insert(schema.teams)
      .values({
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "التصميم",
        color: "#EC4899",
        description: "Design team",
      })
      .returning();

    // Memberships
    for (const u of [owner, admin, member1, member2, guest]) {
      const role = u.id === owner.id ? "owner" : u.id === admin.id ? "admin" : u.id === guest.id ? "guest" : "member";
      await db.insert(schema.memberships).values({
        userId: u.id,
        organizationId: org.id,
        workspaceId: null,
        teamId: u.id === member1.id || u.id === owner.id ? teamDesign.id : teamEng.id,
        role: role as any,
      });
    }

    // Projects
    const [proj1] = await db
      .insert(schema.projects)
      .values({
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "إطلاق منصة CalmBoard 2.0",
        description: "إعادة تصميم وتطوير منصة إدارة المشاريع مع ميزات الذكاء الاصطناعي",
        color: "#7C3AED",
        icon: "rocket",
        status: "active",
        priority: "high",
        ownerId: owner.id,
        privacy: "workspace",
        progress: 62,
        estimatedHours: 320,
        loggedHours: 198,
        startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        endDate: new Date(Date.now() + 45 * 24 * 3600 * 1000),
      })
      .returning();

    const [proj2] = await db
      .insert(schema.projects)
      .values({
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "Mobile App Redesign",
        description: "Complete redesign of mobile experience with new design system",
        color: "#0EA5E9",
        icon: "smartphone",
        status: "active",
        priority: "medium",
        ownerId: admin.id,
        progress: 38,
        estimatedHours: 180,
        loggedHours: 72,
      })
      .returning();

    const [proj3] = await db
      .insert(schema.projects)
      .values({
        organizationId: org.id,
        workspaceId: ws2.id,
        name: "حملة التسويق Q1",
        description: "إطلاق الحملة التسويقية للربع الأول مع محتوى جديد",
        color: "#10B981",
        icon: "trending-up",
        status: "active",
        priority: "urgent",
        ownerId: member1.id,
        progress: 21,
      })
      .returning();

    // Sections
    const sectionsProj1 = await db
      .insert(schema.projectSections)
      .values([
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj1.id, name: "تخطيط", order: 0, color: "#94A3B8" },
        {
          organizationId: org.id,
          workspaceId: ws1.id,
          projectId: proj1.id,
          name: "قيد التنفيذ",
          order: 1,
          color: "#F59E0B",
        },
        {
          organizationId: org.id,
          workspaceId: ws1.id,
          projectId: proj1.id,
          name: "مراجعة",
          order: 2,
          color: "#0EA5E9",
        },
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj1.id, name: "مكتمل", order: 3, color: "#10B981" },
      ])
      .returning();

    const sectionsProj2 = await db
      .insert(schema.projectSections)
      .values([
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj2.id, name: "Backlog", order: 0 },
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj2.id, name: "In Progress", order: 1 },
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj2.id, name: "Review", order: 2 },
        { organizationId: org.id, workspaceId: ws1.id, projectId: proj2.id, name: "Done", order: 3 },
      ])
      .returning();

    // Tasks seed
    const taskData = [
      {
        title: "تصميم نظام الألوان والـ Design Tokens",
        status: "done",
        priority: "high",
        sectionId: sectionsProj1[3].id,
        projectId: proj1.id,
        assigneeId: member1.id,
        tags: ["design", "tokens"],
        progress: 100,
        order: 0,
        serial: "TASK-1042",
      },
      {
        title: "بناء هيكل Monorepo مع Turborepo",
        status: "done",
        priority: "high",
        sectionId: sectionsProj1[3].id,
        projectId: proj1.id,
        assigneeId: member2.id,
        tags: ["infra", "setup"],
        progress: 100,
        order: 1,
        serial: "TASK-1043",
      },
      {
        title: "تنفيذ مصادقة متعددة المستأجرين",
        status: "in_progress",
        priority: "urgent",
        sectionId: sectionsProj1[1].id,
        projectId: proj1.id,
        assigneeId: admin.id,
        tags: ["auth", "security"],
        progress: 65,
        order: 0,
        serial: "TASK-1044",
      },
      {
        title: "واجهة إدارة المشاريع - List View",
        status: "in_progress",
        priority: "high",
        sectionId: sectionsProj1[1].id,
        projectId: proj1.id,
        assigneeId: owner.id,
        tags: ["frontend", "projects"],
        progress: 45,
        order: 1,
        serial: "TASK-1045",
      },
      {
        title: "Kanban Board مع dnd-kit",
        status: "todo",
        priority: "high",
        sectionId: sectionsProj1[0].id,
        projectId: proj1.id,
        assigneeId: member2.id,
        tags: ["kanban", "dnd"],
        progress: 0,
        order: 2,
        serial: "TASK-1046",
      },
      {
        title: "تكامل الذكاء الاصطناعي لاقتراح المهام",
        status: "todo",
        priority: "medium",
        sectionId: sectionsProj1[0].id,
        projectId: proj1.id,
        assigneeId: admin.id,
        tags: ["ai", "automation"],
        progress: 0,
        order: 3,
        serial: "TASK-1047",
      },
      {
        title: "Build dashboard builder with widgets",
        status: "backlog",
        priority: "medium",
        sectionId: sectionsProj2[0].id,
        projectId: proj2.id,
        assigneeId: member1.id,
        tags: ["dashboard"],
        progress: 0,
        order: 0,
        serial: "TASK-1048",
      },
      {
        title: "Mobile bottom navigation",
        status: "review",
        priority: "medium",
        sectionId: sectionsProj2[2].id,
        projectId: proj2.id,
        assigneeId: member1.id,
        tags: ["mobile", "ux"],
        progress: 90,
        order: 1,
        serial: "TASK-1049",
      },
      {
        title: "إعداد حملة إعلانية لتيك توك",
        status: "todo",
        priority: "urgent",
        sectionId: sectionsProj1[0].id,
        projectId: proj3.id,
        assigneeId: member1.id,
        tags: ["marketing", "ads"],
        progress: 0,
        order: 0,
        serial: "TASK-1050",
      },
      {
        title: "تحليل أداء العملاء الحاليين",
        status: "in_progress",
        priority: "low",
        sectionId: sectionsProj1[1].id,
        projectId: proj3.id,
        assigneeId: guest.id,
        tags: ["analytics"],
        progress: 30,
        order: 1,
        serial: "TASK-1051",
      },
    ];

    for (const t of taskData) {
      const [created] = await db
        .insert(schema.tasks)
        .values({
          organizationId: org.id,
          workspaceId: t.projectId === proj3.id ? ws2.id : ws1.id,
          projectId: t.projectId,
          sectionId: t.sectionId,
          title: t.title,
          description: t.title.includes("تصميم")
            ? "## الهدف\nتحسين تجربة المستخدم عبر نظام ألوان متناسق يدعم الوضعين الفاتح والداكن\n\n- استخدام semantic tokens\n- دعم RTL/LTR\n- اختبار التباين WCAG AA"
            : "Task description with rich details. Supports markdown, checklists, mentions.",
          status: t.status as any,
          priority: t.priority as any,
          assigneeId: t.assigneeId,
          reporterId: owner.id,
          serial: t.serial,
          tags: t.tags,
          order: t.order,
          progress: t.progress,
          dueDate: new Date(Date.now() + (Math.floor(Math.random() * 20) - 5) * 24 * 3600 * 1000),
          estimatedHours: Math.floor(Math.random() * 16) + 2,
          storyPoints: [1, 2, 3, 5, 8][Math.floor(Math.random() * 5)],
        })
        .returning();
      // comment
      await db.insert(schema.comments).values({
        organizationId: created.organizationId,
        workspaceId: created.workspaceId,
        taskId: created.id,
        userId: owner.id,
        content:
          t.status === "done"
            ? "تم الانتهاء بنجاح! ✅ ممتاز عمل رائع"
            : t.status === "in_progress"
              ? "أعمل على هذه المهمة، سأحتاج مراجعة من @sara"
              : "سأبدأ العمل قريباً إن شاء الله",
      });
    }

    // Docs
    await db.insert(schema.docs).values([
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        projectId: proj1.id,
        title: "دليل التصميم - Design System",
        content: "# CalmBoard Design System\n## الألوان\nsemantic tokens...",
        authorId: owner.id,
        icon: "palette",
      },
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        title: "خطة إطلاق المنتج",
        content: "# Launch Plan\n- Phase 0: Foundation\n- Phase 1: MVP",
        authorId: admin.id,
        icon: "map",
      },
    ]);

    // Goals
    await db.insert(schema.goals).values([
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        title: "زيادة رضا العملاء إلى 95%",
        type: "objective",
        progress: 68,
        status: "on_track",
        ownerId: owner.id,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      },
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        title: "إطلاق النسخة 2.0 في الموعد",
        type: "key_result",
        progress: 62,
        status: "at_risk",
        ownerId: admin.id,
      },
    ]);

    // Automations
    await db.insert(schema.automations).values([
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "عند اكتمال المهمة -> انقل للمراجعة",
        trigger: "task_status_changed",
        conditions: { status: "done" },
        actions: { notify: "assignee", move: "review" },
        enabled: true,
        runs: 24,
      },
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        name: "تذكير بالمهام المتأخرة",
        trigger: "schedule_daily",
        conditions: {},
        actions: { email: "overdue" },
        enabled: true,
        runs: 156,
      },
    ]);

    // Notifications
    await db.insert(schema.notifications).values([
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        userId: owner.id,
        type: "task_assigned",
        title: "تم تعيين مهمة جديدة لك",
        body: "قام Alex بتعيين TASK-1045 لك",
        entityType: "task",
        isRead: false,
      },
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        userId: owner.id,
        type: "comment_mention",
        title: "تمت الإشارة إليك في تعليق",
        body: "عمر: @نورا هل يمكنك مراجعة التصميم؟",
        entityType: "comment",
        isRead: false,
      },
      {
        organizationId: org.id,
        workspaceId: ws1.id,
        userId: owner.id,
        type: "due_soon",
        title: "مهمة تستحق قريباً",
        body: "TASK-1044 تستحق غداً",
        entityType: "task",
        isRead: true,
      },
    ]);

    const extras = await ensureExtras();
    return { ok: true, orgId: org.id, workspaceId: ws1.id, extras };
  } catch (e: any) {
    console.error(e);
    throw e;
  }
}
