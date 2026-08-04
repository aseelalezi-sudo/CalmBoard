import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const openapi = {
    openapi: "3.0.3",
    info: {
      title: "CalmBoard Enterprise API Reference",
      version: "2.0.0",
      description:
        "وثائق واجهة برمجة التطبيقات الرسمية لمنصة CalmBoard لإدارة المشاريع والعمل الجماعي (SaaS Work Management REST API). مدعومة بالعزل الكامل للمستأجرين وتوقيع HMAC.",
      contact: {
        name: "CalmBoard Engineering & Security",
        email: "engineering@calmboard.internal",
        url: "https://calmboard.internal",
      },
    },
    servers: [
      { url: "/api", description: "Current Local / Cloud Runtime API Gateway" },
      { url: "https://api.calmboard.com/v2", description: "Production High-Availability Cluster" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT / Refresh Token Rotation",
          description: "تجزئة كلمات المرور عبر Argon2id وتدوير التوكنات الآمن مع التحقق في الخادم لكل طلب.",
        },
        WebhookSignature: {
          type: "apiKey",
          in: "header",
          name: "x-calmboard-signature",
          description:
            "توقيع HMAC SHA-256 للتحقق من مصداقية الأحداث الواردة من التكاملات (GitHub, Slack, Custom Webhooks).",
        },
      },
      schemas: {
        Task: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid", example: "550e8400-e29b-41d4-a716-446655440000" },
            serial: { type: "string", example: "TASK-1042", description: "رقم تسلسلي فريد وقابل للقراءة للبشر" },
            title: { type: "string", example: "تصميم نظام الألوان والـ Design Tokens" },
            description: { type: "string", example: "توصيف تفصيلي يدعم Markdown وقوائم المهام الفرعية والإشارات." },
            status: {
              type: "string",
              enum: ["backlog", "todo", "in_progress", "review", "done", "canceled"],
              example: "in_progress",
            },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"], example: "urgent" },
            progress: { type: "integer", minimum: 0, maximum: 100, example: 65 },
            estimatedHours: { type: "number", example: 16 },
            loggedHours: { type: "number", example: 8.5 },
            storyPoints: { type: "integer", example: 5 },
            assigneeId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            workspaceId: { type: "string", format: "uuid" },
            organizationId: { type: "string", format: "uuid" },
            dueDate: { type: "string", format: "date-time", example: "2026-08-01T12:00:00Z" },
            createdAt: { type: "string", format: "date-time" },
          },
          required: ["id", "serial", "title", "status", "priority", "workspaceId", "organizationId"],
        },
        Project: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string", example: "إطلاق منصة CalmBoard 2.0" },
            description: { type: "string" },
            status: {
              type: "string",
              enum: ["planning", "active", "on_hold", "completed", "archived"],
              example: "active",
            },
            color: { type: "string", example: "#6366F1" },
            icon: { type: "string", example: "🚀" },
            progress: { type: "integer", example: 62 },
            workspaceId: { type: "string", format: "uuid" },
          },
        },
        FormResponseSubmission: {
          type: "object",
          properties: {
            values: {
              type: "object",
              additionalProperties: { type: "string" },
              example: {
                title: "طلب إضافة ميزة التباين الداكن",
                details: "نريد تحسين ألوان القوائم السفلية في الجوال.",
              },
            },
            captchaToken: { type: "string", description: "Single-use Cloudflare Turnstile token" },
          },
          required: ["values", "captchaToken"],
        },
        IntegrationSyncRequest: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["github", "slack", "gcal", "microsoft"], example: "github" },
            organizationId: { type: "string", format: "uuid" },
            workspaceId: { type: "string", format: "uuid" },
          },
          required: ["provider", "organizationId", "workspaceId"],
        },
        IntegrationWebhookEndpointRequest: {
          type: "object",
          properties: {
            organizationId: { type: "string", format: "uuid" },
            workspaceId: { type: "string", format: "uuid" },
            actorId: { type: "string", format: "uuid" },
            provider: { type: "string", enum: ["github", "slack", "webhook"] },
            displayName: { type: "string", maxLength: 160 },
          },
          required: ["organizationId", "workspaceId", "actorId", "provider", "displayName"],
        },
      },
    },
    paths: {
      "/tasks": {
        get: {
          summary: "استعراض المهام مع الفلترة والعزل (Get Tasks)",
          description:
            "يجلب المهام الخاصة بمشروع أو مساحة عمل محددة مع إمكانية التصفية حسب الحالة، الأولوية، والبحث الحرفي.",
          parameters: [
            {
              name: "projectId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "معرف المشروع لتصفية المهام",
            },
            {
              name: "workspaceId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "معرف مساحة العمل",
            },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done"] },
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string" },
              description: "بحث في العنوان أو الرمز التسلسلي TASK-xxx",
            },
          ],
          responses: {
            "200": {
              description: "قائمة المهام المسترجعة بعد فحص الصلاحيات وعزل المستأجرين.",
              content: {
                "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Task" } } },
              },
            },
          },
        },
        post: {
          summary: "إنشاء مهمة جديدة (Create Task)",
          description:
            "يقوم بإنشاء مهمة جديدة في المشروع، وتوليد رقم تسلسلي تلقائي TASK-xxx، وإطلاق أي قواعد أتمتة مطابقة (When Task Created).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string", example: "تنفيذ نظام الصلاحيات في الواجهة" },
                    description: { type: "string" },
                    priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                    status: { type: "string", enum: ["todo", "in_progress"] },
                    projectId: { type: "string", format: "uuid" },
                    workspaceId: { type: "string", format: "uuid" },
                    organizationId: { type: "string", format: "uuid" },
                  },
                  required: ["title", "projectId", "workspaceId", "organizationId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "تم إنشاء المهمة بنجاح",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } },
            },
          },
        },
      },
      "/projects": {
        get: {
          summary: "استعراض المشاريع (Get Projects)",
          parameters: [
            { name: "workspaceId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Project" } } },
              },
            },
          },
        },
      },
      "/ai": {
        post: {
          summary: "تشغيل معالج الذكاء الاصطناعي (AI Provider Layer Adapter)",
          description:
            "تنفيذ عمليات الذكاء الاصطناعي على البيانات: تقرير القيادة، تلخيص المشاريع، تقسيم المهام، اقتراح الأولوية، أو الترجمة اللحظية.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: {
                      type: "string",
                      enum: [
                        "breakdown",
                        "summarize",
                        "report",
                        "meeting_notes",
                        "priority",
                        "translate",
                        "generate_task",
                      ],
                    },
                    text: { type: "string", example: "اجتماع الربع الثالث لمناقشة أداء فريق الهندسة والأمان" },
                  },
                  required: ["action"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "نتيجة المعالجة الذكية المسترجعة من مزود الـ AI",
              content: {
                "application/json": { schema: { type: "object", properties: { result: { type: "string" } } } },
              },
            },
          },
        },
      },
      "/integrations/sync": {
        post: {
          summary: "اختبار اتصال OAuth بالتكامل (Verify Integration OAuth Connection)",
          description:
            "يجدد رمز OAuth المنتهي عند توفر Refresh Token، ثم يستدعي واجهة المزود للتحقق من هوية الحساب المرتبط دون إعادة الرموز السرية للعميل.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/IntegrationSyncRequest" } } },
          },
          responses: {
            "200": {
              description: "تم التحقق من اتصال OAuth وهوية الحساب بنجاح",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      provider: { type: "string" },
                      account: {
                        type: "object",
                        properties: { id: { type: "string" }, displayName: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/integrations/webhooks": {
        get: {
          summary: "عرض مستقبلات Webhook المعزولة لمساحة العمل",
          parameters: [
            { name: "organizationId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
            { name: "workspaceId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
            { name: "actorId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "قائمة endpoints دون الرموز السرية أو raw payloads" } },
        },
        post: {
          summary: "إنشاء مستقبل Webhook آمن",
          description: "يعاد endpointToken مرة واحدة؛ لا تخزن قاعدة البيانات إلا بصمة SHA-256 له.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IntegrationWebhookEndpointRequest" } },
            },
          },
          responses: { "201": { description: "Endpoint جديد مع receiverPath والرمز المعروض مرة واحدة" } },
        },
      },
      "/integrations/webhooks/{id}": {
        delete: {
          summary: "إبطال مستقبل Webhook",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            { name: "organizationId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
            { name: "workspaceId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
            { name: "actorId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: { "200": { description: "أُبطل endpoint ولن يحل الخادم رمزه بعد الآن" } },
        },
      },
      "/integrations/webhooks/receive/{provider}/{endpointToken}": {
        post: {
          summary: "استقبال حدث موقّع ومنع replay",
          description:
            "GitHub: x-hub-signature-256 وx-github-delivery. Slack: x-slack-signature وx-slack-request-timestamp. Custom: x-calmboard-signature وx-calmboard-timestamp وx-calmboard-delivery. يتحقق الخادم من raw body ويسجل معرف التسليم ذرياً.",
          security: [],
          parameters: [
            {
              name: "provider",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["github", "slack", "webhook"] },
            },
            { name: "endpointToken", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          responses: {
            "200": { description: "الحدث مقبول؛ يوضح replayed إن سبق استلام معرف التسليم نفسه" },
            "401": { description: "توقيع غير صحيح/قديم أو endpoint مجهول/مبطل" },
            "409": { description: "أعيد استخدام معرف التسليم مع payload مختلف" },
          },
        },
      },
      "/forms/{id}/submit": {
        post: {
          summary: "إرسال رد على نموذج عام وتحويله لمهمة (Public Form Submission)",
          description:
            "يستقبل ردود المستفيدين أو العملاء عبر الرابط العام للنموذج ويقوم تلقائياً بتحويل الرد إلى مهمة في المشروع المستهدف.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/FormResponseSubmission" } } },
          },
          responses: {
            "200": {
              description: "تم استلام الرد وتحويله لمهمة",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" }, serial: { type: "string", example: "TASK-1064" } },
                  },
                },
              },
            },
          },
        },
      },
      "/admin/security-tests": {
        get: {
          summary: "تشغيل حزمة الفحص المؤتمت للأمان وعزل المستأجرين (Security & Tenancy Automated Suite)",
          description:
            "ينفذ 5 اختبارات أمنية بالوقت الحقيقي على قاعدة بيانات PostgreSQL: العزل بين المؤسسات، RBAC، تشفير HMAC، عزل مساحات العمل، وسلامة سجل التدقيق.",
          responses: {
            "200": {
              description: "تقرير الفحص الفوري مع زمن الاستجابة بالمللي ثانية",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { summary: { type: "object" }, tests: { type: "array" } } },
                },
              },
            },
          },
        },
      },
    },
  };

  return NextResponse.json(openapi);
}
