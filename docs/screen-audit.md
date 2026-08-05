# CalmBoard Screen & Feature Audit

> Last reviewed: 2026-08-01
>
> هذا التقرير يميّز بين الوظيفة المرتبطة فعلياً بقاعدة البيانات، والوظيفة الجزئية، والمحاكاة التطويرية. لا نعتبر أي شاشة Production-complete لمجرد أنها تظهر في الواجهة.

## حالة عامة

### مكتمل أو مرتبط فعلياً

- جدول المهام: تحميل من PostgreSQL، فلترة، ترتيب، تعديل مباشر، تحديد جماعي، CSV/Excel/Print، وحفظ الفرز وترتيب الأعمدة وتثبيتها وأحجامها ضمن Saved Views خاصة أو مشتركة.
- Kanban: سحب وإفلات مع حفظ الحالة، WIP limit محلي.
- تفاصيل المهمة: تحديثات، مهام فرعية، تعليقات، تفاعلات، تثبيت/تعديل/حذف، مرفقات API، روابط خارجية، تبعيات JSON، تذكيرات محفوظة داخل المهمة.
- المستندات: Block editor، Slash Commands، قوالب، حفظ، تحويل النص إلى مهمة، إصدارات واستعادة.
- الأهداف: progress، health status، Check-ins محفوظة في PostgreSQL.
- الوقت: Timer، سجلات وقت، billing flag، واجهة موافقات.
- النماذج: Builder شرطي، رابط عام محمي بـTurnstile، حفظ دائم للرد، وتحويله إلى مهمة خارج دورة الطلب عبر Worker قابل لإعادة المحاولة.
- الأتمتة: محرك server-side، أحداث معاملية، BullMQ scheduler، Retry/DLQ، حماية حلقات، سجل تشغيل، وTest Run.
- أعضاء/RBAC: memberships، أدوار، مهارات، workload، دعوات للأعضاء الموجودين/الجدد.
- الفوترة: adapter Stripe حقيقي عند وجود المفتاح، محاكاة عند عدم وجوده، Webhook verification، usage_limits.
- AI: OpenAI/Anthropic adapter حقيقي عند وجود المفاتيح، fallback محلي/محاكاة عند غيابها.
- PWA: manifest وservice worker.
- OpenAPI: مواصفة JSON وواجهة API Reference.
- Security Suite: اختبارات عزل/RBAC/HMAC/audit تعمل عبر `/api/admin/security-tests`.
- Docker/CI: Dockerfile، Compose، Playwright config، workflow CI.
- الإعدادات: اسم مساحة العمل، اللون، الوصف، custom fields، وتصدير JSON وPDF وExcel من الخادم، وجدولة PDF/Excel بالبريد.

## الشاشات وتقييمها

| الشاشة           | الحالة الحالية            | ما تم تدقيقه                                                                                                                                                                | العمل الضروري قبل Production                                                                            |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Table            | حقيقية قوية               | CRUD/inline/bulk/export/virtualization وSaved Views وحفظ حالة الأعمدة والفرز وcursor pagination وserver-side filtering واختبار 100 ألف مهمة                                 | مراقبة خطط الاستعلام وحدود زمن الاستجابة في الإنتاج                                                     |
| Board            | حقيقية قوية               | touch DnD وحفظ status/order وWIP persisted وصفحات مستقلة لكل عمود ونقل ذري مرتكز على الجيران واختبار 100 ألف مهمة                                                           | تحسين UX لتعارضات realtime بين عدة عملاء واختبارات متصفح E2E                                            |
| List             | حقيقية                    | inline edits وfilters                                                                                                                                                       | grouping متعدد، column persistence، keyboard spreadsheet actions                                        |
| Calendar         | جزئية                     | due dates وإضافة سريعة                                                                                                                                                      | drag/resize، recurring display، timezone، external calendar sync                                        |
| Timeline/Gantt   | عرض تفاعلي جزئي           | zoom، dependencies visual، critical highlight                                                                                                                               | حساب critical path حقيقي، milestones، baselines، conflict engine، drag dates                            |
| Workload         | حقيقية بسعة وإجازات مخزنة | capacity/rebalance، weekly availability، holidays/vacations، tenant-scoped capacity DB                                                                                      | assignment optimizer المتقدم                                                                            |
| My Work          | حقيقية                    | assigned/overdue/completed                                                                                                                                                  | approvals، followers، personal saved filters، cross-workspace pagination                                |
| Dashboard        | حقيقية                    | KPI/range/custom chart/export وwidgets persisted in DB وdrag/resize وPDF/Excel server export وتقارير مجدولة بالبريد                                                         | مشاركة لوحة المعلومات وتخزين الاستعلامات الثقيلة مؤقتًا                                                 |
| Docs             | حقيقية جزئياً             | TipTap/Markdown، headings/lists/tables/links/HTTPS images/code/callouts/checklists، templates، versions/restore، وتحويل النص المحدد إلى مهمة                                | nested pages، صلاحيات منفصلة أدق، full-text search، رفع ملفات داخل المستند، comments، collaborative Yjs |
| Goals/OKRs       | حقيقية جزئياً             | checkins/progress/health                                                                                                                                                    | key results relation tables، linked task/project rollups، comments، periods، check-in reminders         |
| Time             | حقيقية جزئياً             | timer/logs/approvals UI                                                                                                                                                     | approval tables/status، overlap detection، lock periods، timezone normalization                         |
| Automations      | حقيقية قوية               | transactional events، BullMQ scheduler، retry/DLQ، stale-claim recovery، loop guard، daily scheduler، idempotency                                                           | delayed user-authored actions، richer rule debugger                                                     |
| Forms            | حقيقية                    | builder وconditional logic وTurnstile وpublic submit وحفظ الرد ثم إنشاء المهمة عبر Worker مستقل مع retry/DLQ وexactly-once                                                  | password/expiry/limits/file uploads                                                                     |
| Integrations     | adapter/UI                | sync/HMAC simulation                                                                                                                                                        | OAuth token storage/refresh، provider webhooks، retry ledger، real API adapters                         |
| Billing          | Stripe lifecycle حقيقية   | checkout وwebhook idempotency وcustomer/subscription IDs وpayment failure/recovery وgrace period وcancellation مع إعادة Free entitlements                                   | customer portal، proration، coupons، وفرض usage limits في جميع مسارات الخادم                            |
| Members/RBAC     | حقيقية ومحمية             | صلاحيات قاعدة البيانات، ستة أدوار نظامية، أدوار مخصصة، ربط organization/workspace/project، وسياسة صريحة لكل Route محمي مع Auth/Tenant/Permission guards وRLS                | تحسين واجهة إدارة project overrides فقط                                                                 |
| Account/Security | حقيقية عدا المعاينات      | real session/device management, preferences, TOTP, one-time recovery codes, and feature-flagged Google/Microsoft OAuth login; WebAuthn hidden behind an off-by-default flag | real WebAuthn/Passkeys implementation                                                                   |
| Inbox            | real notifications        | unread/read                                                                                                                                                                 | grouping, mentions, digest worker, push/browser permission, DND enforcement                             |
| Admin            | partial                   | metrics/security، Redis queue metrics، PostgreSQL DLQ، safe retry                                                                                                           | admin action audit، persisted flags، safe impersonation                                                 |
| API Reference    | real docs                 | OpenAPI viewer                                                                                                                                                              | schema validation, generated DTOs/Zod, rate-limit docs, auth test console                               |
| Public Form      | real durable flow         | validated response، Turnstile، durable deferred task creation، retry/DLQ                                                                                                    | password/expiry/limits، file scanning، accessibility audit                                              |

## أهم فجوات Production الحالية

### P0 — يجب تنفيذها قبل أي إطلاق تجاري

1. **استكمال المصادقة**: أزيل `DEV_MODE` وأضيفت secure session cookies والتحقق من البريد واستعادة كلمة المرور وRedis Rate Limiting والقفل التدريجي وإدارة الجلسات والأجهزة وTOTP وRecovery Codes ودخول Google/Microsoft OAuth خلف Feature Flags وسجل أمني Append-only لمحاولات الدخول والتغييرات الأمنية؛ ما زال WebAuthn الحقيقي وتدقيق تغييرات الأدوار وبقية Mutations مطلوبين في مراحلهما اللاحقة.
2. **Server authorization**: أضيف Resolver من قاعدة البيانات وحراس Auth/Tenant/Permission عالميون، ويستبدل Tenant Guard هوية المنفذ بهوية الجلسة ويتحقق من عضوية النطاق. بدأ فرض السياسات على Billing وExport والتكاملات والأعضاء ومساحة العمل؛ تبقى تغطية كل Mutation وحماية Admin/Audit والواجهة.
3. **استكمال Tenant isolation**: أضيف RLS وسياق transaction واختبارات العزل الأساسية؛ تبقى تغطية cross-tenant لكل mutation وإزالة معرفات الهوية المرسلة من العميل.
4. **Input validation**: إضافة Zod schemas مشتركة لكل Route Handler ورفض القيم غير الصحيحة قبل Drizzle.
5. **Real storage**: presigned S3/R2/MinIO upload، MIME validation، signed download، orphan cleanup.
6. **Real queues**: اكتمل Worker المنفصل للتذكيرات والبريد والأتمتة والتصدير مع Retry وDLQ ولوحة Redis/PostgreSQL؛ تبقى مقاييس تاريخية وتنبيهات تشغيلية أعمق.
7. **Billing correctness**: اكتملت Stripe customer/subscription IDs وwebhook idempotency ودورة invoice paid/failed/canceled وgrace period؛ تبقى customer portal وproration وcoupons وفرض الحدود خادمياً.

### P1 — يجب تنفيذها قبل Beta العامة

1. WebSocket/SSE realtime rooms مع reconnect وconflict versioning.
2. cursor pagination وvirtualization للجدول/اللوحة.
3. اكتمل PostgreSQL FTS/trigram للأنواع السبعة وSearch Provider القابل للاستبدال وربط Command Palette بالـAPI نفسه، مع حالات التحميل والخطأ وإعادة المحاولة والنتائج المتعددة.
4. اكتمل حذف البيانات التشغيلية المحاكية من الشاشات الرئيسية: الإدارة تعرض قاعدة البيانات والطوابير الفعلية، والتكاملات تعرض الاعتمادات الفعلية، وAI يفشل بوضوح عند غياب مزود حقيقي.
5. اكتمل Forms builder الشرطي وCAPTCHA وتحويل الرد إلى مهمة عبر Worker؛ تبقى password/expiry/limits وfile upload.
6. Docs nested pages/permissions/search.
7. Timesheet approvals/lock/overlap checks في schema.
8. Custom roles وproject-level permissions.
9. Integration OAuth adapters لـ GitHub/Slack/Google Calendar.
10. اكتمل PDF/Excel server export والتقارير المجدولة بالبريد؛ تبقى مشاركة اللوحة وتخزين الاستعلامات الثقيلة مؤقتًا.
11. Accessibility/WCAG and mobile QA عبر Playwright.

### P2 — تحسينات Enterprise

1. OpenTelemetry exporter/Sentry/Prometheus فعلي.
2. Backups encrypted + restore drill.
3. data retention/deletion/export jobs.
4. SSO/SAML وSCIM للمؤسسات.
5. API rate limiting وAPI keys وidempotency middleware.
6. Load testing k6، slow query dashboard، read replicas.
7. Kubernetes manifests، secrets manager، zero-downtime migration workflow.
8. Billing plans/entitlements persisted بدل الحسابات الثابتة في الواجهة.

## ترتيب التنفيذ المقترح

1. Auth + tenant middleware + Zod + RBAC guards.
2. RLS/isolation tests + mutation audit.
3. Redis/BullMQ worker + reminders/digests/automations.
4. S3 upload and secure file access.
5. Stripe production lifecycle and idempotency.
6. Realtime + conflict handling.
7. Pagination/virtualization/search.
8. Docs/Form/Timesheet hardening.
9. OAuth integrations.
10. E2E/load/accessibility/security review.
11. Docker/Kubernetes staging deployment and backup restore test.

## معيار قبول واقعي للإطلاق

لا نعلن Production حتى تمر جميع البنود التالية:

- لا يوجد endpoint إنتاجي يعتمد على `userId` أو `organizationId` من client body لتحديد الصلاحية.
- كل mutation يمر عبر auth + tenant + permission + validation.
- اختبار cross-tenant لكل الجداول التابعة ينجح.
- فشل Stripe لا يمنح entitlements.
- رفع الملفات يمر عبر presigned policy وفحص النوع والحجم.
- automation/email/reminder لا تعمل داخل request lifecycle.
- Playwright يعمل على Chrome وFirefox وWebKit.
- load test للجدول والبحث مع 100k task fixture.
- WCAG keyboard/focus/contrast يمر في الشاشات الأساسية.
- backup restore مثبت على بيئة منفصلة.
