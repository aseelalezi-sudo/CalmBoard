# CalmBoard — Full Product Audit & Feature Gap Analysis

> تحديث بوابة الإصدار (2026-08-09): أُغلقت عوائق P0 في M1. راجع
> [تقرير M1 P0](./m1-p0-release-safety-gate.md) لنتائج التحقق النهائية. تبقى
> عناصر P1/P2/P3 الواردة في هذا التدقيق مؤجلة ولم يبدأ M2.

تاريخ التدقيق: 2026-08-09
المسار المدقق: `D:\CalmBoard`

## 1. الملخص التنفيذي

المشروع ليس نموذجًا أوليًا؛ لديه أساس هندسي قوي وتغطية واسعة لإدارة المشاريع والمهام، المصادقة، RBAC/RLS، البحث، الملفات، الأتمتة، العمال، الفوترة، المراقبة والنسخ الاحتياطي.

لكن النسخة الحالية ليست جاهزة للإطلاق الإنتاجي بسبب ثلاث مجموعات من موانع الإطلاق:

1. واجهات تفعيل وتعطيل ترخيص المنصة عامة ويمكن استدعاؤها دون تسجيل دخول.
2. دفعة Sprints غير مدمجة بالكامل: ملفات كثيرة غير متتبعة، فشل تحقق قاعدة البيانات الفارغة، وفشل اختبار integration.
3. إعداد Docker الإنتاجي لا يمرر متغيرات ضرورية لرسائل المصادقة، فحص المرفقات، Turnstile، AI وOAuth integrations، مع وجود قيم أسرار تطويرية افتراضية.

| الجانب                     | التقدير |
| -------------------------- | ------: |
| اكتمال الميزات الأساسية    |     78% |
| جودة الأساس الهندسي        |     82% |
| جاهزية Staging             |     68% |
| جاهزية Production          |     55% |
| الجاهزية الإجمالية للإطلاق |     61% |

قرار التدقيق: **NO-GO للإنتاج حاليًا**. يمكن الوصول إلى Staging موثوق بعد إغلاق P0 ثم P1 الأساسية.

## 2. Architecture Map

```text
Next.js Web
  ├─ client-api + CSRF + Cookie session
  ├─ Zustand للحالة المحلية
  ├─ TanStack Query، خصوصًا Sprints
  └─ Socket.IO للحضور وإبطال البيانات

NestJS / Fastify API
  ├─ AuthGuard
  ├─ TenantGuard
  ├─ PermissionGuard / PlatformAdminGuard
  ├─ CSRF + Redis Rate Limiting
  ├─ TenantDatabaseInterceptor
  ├─ Services
  └─ Drizzle Repositories

PostgreSQL
  ├─ 83 جدولًا
  ├─ 61 migration من 0000 إلى 0060
  ├─ RBAC relational
  ├─ RLS/FORCE RLS
  ├─ GIN/Trigram Search
  └─ Outbox/Dead-letter/Idempotency

Worker / BullMQ / Redis
  ├─ Auth and notification emails
  ├─ Reminders and automations
  ├─ Form submissions
  ├─ Exports and reports
  ├─ Attachment cleanup
  └─ Billing grace periods

External: MinIO/S3, Resend, Stripe, OAuth, AI providers,
Sentry, Prometheus, OpenTelemetry and Tempo.
```

تطبيق الويب لا يصل مباشرة إلى PostgreSQL أو Drizzle؛ وصول البيانات يمر عبر API. هذه النقطة مكتملة معماريًا.

## 3. Product Feature Matrix

| الميزة                              | الحالة          | الأولوية | النتيجة                                                                         |
| ----------------------------------- | --------------- | -------: | ------------------------------------------------------------------------------- |
| التسجيل وتسجيل الدخول والجلسات      | COMPLETE        |       P1 | Argon2id، cookies، refresh rotation، lockout                                    |
| استعادة كلمة المرور والتحقق بالبريد | PARTIAL         |       P1 | مكتملة برمجيًا، إعداد Docker لا يمرر مفتاح تشفير البريد إلى API                 |
| OAuth Google/Microsoft              | COMPLETE        |       P2 | PKCE وربط هوية ومراعاة MFA                                                      |
| TOTP MFA وRecovery Codes            | COMPLETE        |       P1 | تشفير ودعم إدارة الجلسات                                                        |
| Organizations                       | PARTIAL         |       P2 | الإنشاء ضمن التسجيل؛ إدارة/حذف المؤسسة غير مكتملين                              |
| Workspaces                          | COMPLETE        |       P2 | قائمة، إنشاء، تعديل، تبديل وعزل                                                 |
| Projects CRUD                       | COMPLETE        |       P2 | حقول كاملة، أرشفة، استعادة وحذف منطقي                                           |
| Project templates                   | COMPLETE        |       P2 | قوالب Scrum/Marketing/Roadmap/Bugs                                              |
| Task templates                      | NOT IMPLEMENTED |       P3 | لا يوجد نموذج قالب مهام قابل لإعادة الاستخدام                                   |
| Tasks                               | COMPLETE        |       P2 | CRUD، import، subtasks، assignees، followers، tags                              |
| Board/List/Table/Calendar/Timeline  | COMPLETE        |       P2 | واجهات مترابطة مع API                                                           |
| Pagination على نطاق كبير            | COMPLETE        |       P2 | اختبار 100,000 مهمة نجح في نحو 319ms                                            |
| WIP limits وKanban ordering         | COMPLETE        |       P2 | قفل وتزامن ومعالجة stale updates                                                |
| Dependencies/relations              | COMPLETE        |       P2 | يشمل منع الدورات                                                                |
| Reminders/recurrence                | COMPLETE        |       P2 | تخزين relational وعامل خلفي                                                     |
| Checklists/approvals                | COMPLETE        |       P2 | متعدد المراجعين                                                                 |
| Bulk task actions                   | COMPLETE        |       P2 | حالات، تعيين وحذف جماعي                                                         |
| Sprints lifecycle                   | PARTIAL         |       P0 | frontend/backend موجودان؛ بوابات migration/integration حمراء                    |
| Sprint analytics                    | PARTIAL         |       P0 | velocity/burndown/timeline موجودة؛ الدمج غير مستقر                              |
| Comments                            | PARTIAL         |       P2 | إنشاء/تعديل/حذف/تثبيت/reactions                                                 |
| Comment replies                     | PARTIAL         |       P2 | `parentId` في DB/API، لكن لا توجد تجربة ردود كاملة في الواجهة                   |
| Mentions                            | PLACEHOLDER     |       P1 | النص يقول `@ to mention` دون محلل أو إشعارات mentions                           |
| Realtime presence                   | COMPLETE        |       P2 | غرف tenant-scoped وRedis adapter                                                |
| Live collaboration                  | PARTIAL         |       P2 | invalidation وإعادة تحميل، لا يوجد تحرير تعاوني/typing                          |
| Notifications inbox                 | COMPLETE        |       P2 | قراءة فردية/جماعية وتخزين tenant-scoped                                         |
| Notification preferences            | PARTIAL         |       P2 | إعدادات عامة، لا توجد granular event/channel rules متكاملة                      |
| Email digests                       | COMPLETE        |       P2 | يومية/أسبوعية وعامل durable                                                     |
| Search                              | COMPLETE        |       P2 | PostgreSQL FTS + trigram + ranking + حدود                                       |
| Attachments                         | PARTIAL         |       P0 | الكود قوي؛ Docker لا يمرر إعداد scanner                                         |
| Documents                           | COMPLETE        |       P2 | TipTap، hierarchy، versions، ACL، public link                                   |
| Forms                               | PARTIAL         |       P1 | builder/conditional/CAPTCHA/task creation؛ إعداد Turnstile غير موصول في Compose |
| OKRs/Key Results                    | COMPLETE        |       P2 | أوزان، check-ins وربط بالمهام                                                   |
| Time tracking/timesheets            | COMPLETE        |       P2 | submit/review/locking                                                           |
| Automations                         | COMPLETE        |       P2 | durable events، retries، depth guard وdeduplication                             |
| Integrations credentials/OAuth      | COMPLETE        |       P2 | تشفير، تدوير، PKCE وإلغاء                                                       |
| مزامنة integrations                 | PLACEHOLDER     |       P2 | endpoint الحالي يختبر الاتصال أكثر من تنفيذ مزامنة أعمال فعلية                  |
| AI proposals                        | COMPLETE        |       P2 | موافقة قبل التنفيذ، quota وتسجيل تكلفة                                          |
| AI في Docker                        | PARTIAL         |       P1 | مفاتيح النماذج والأسعار غير ممررة إلى الحاوية                                   |
| Stripe billing                      | PARTIAL         |       P1 | checkout/portal/webhooks/lifecycle موجودة؛ يلزم تحقق staging فعلي               |
| Usage limits                        | COMPLETE        |       P1 | seats/projects/tasks/storage/AI مفروضة في الخادم                                |
| Workspace export                    | PARTIAL         |       P1 | لا يشمل جميع الجداول الحديثة والعلاقات                                          |
| Scheduled reports                   | COMPLETE        |       P2 | timezone، recipients، export/email                                              |
| API documentation                   | PARTIAL         |       P2 | OpenAPI يدوي ويغطي جزءًا محدودًا ولا يشمل Sprints                               |
| Admin queues/dead letters           | COMPLETE        |       P2 | عرض وإعادة محاولة محكومة                                                        |
| Observability                       | COMPLETE        |       P2 | metrics، Sentry، OTel، Prometheus، alerts                                       |
| Deployment                          | PARTIAL         |       P0 | Dockerfiles جيدة لكن wiring وCI images غير مكتملين                              |
| Backup/restore tooling              | COMPLETE        |       P1 | مشفر ومعزول؛ لم يُنفذ drill فعلي في هذا التدقيق                                 |
| Onboarding                          | PARTIAL         |       P1 | Quick Guide ثابت، لا توجد checklist متتبعة                                      |
| Invitation lifecycle                | NOT IMPLEMENTED |       P1 | إنشاء pending فقط؛ لا قبول/إلغاء/إعادة إرسال                                    |
| Account deletion                    | NOT IMPLEMENTED |       P1 | لا يوجد خروج حساب/مؤسسة متكامل                                                  |
| Favorites/recent items              | NOT IMPLEMENTED |       P3 | لا يوجد تخزين أو API واضح                                                       |
| RTL                                 | PARTIAL         |       P1 | الاتجاه مدعوم، لكن توجد نصوص عربية تالفة encoding                               |
| Responsive layout                   | PARTIAL         |       P2 | sidebar مكتبي وbottom nav؛ لا توجد اختبارات viewport شاملة                      |
| Accessibility                       | PARTIAL         |       P2 | labels وfocus موجودة؛ لا توجد axe/WCAG regression suite                         |
| PWA                                 | PARTIAL         |       P3 | manifest/service worker موجودان؛ لا يوجد offline data workflow موثوق            |

## 4. P0 — موانع الإطلاق

### P0.1 واجهات الترخيص العامة

الكلاس `apps/api/src/licensing/licensing.controller.ts` معلّم بالكامل بـ`@PublicRoute()` ويحتوي على:

- `POST /licensing/activate`
- `POST /licensing/deactivate`
- `POST /licensing/refresh`

CSRF يمنع الاستغلال من موقع آخر، لكنه لا يمنع مهاجمًا مباشرًا من طلب CSRF token ثم تغيير ترخيص النسخة. يجب اعتبارها ثغرة تعطيل خدمة وتغيير حالة ترخيص.

### P0.2 دفعة Sprints غير قابلة للإصدار

- migrations `0057–0060` وملفات backend/frontend الخاصة بالسبرنت غير متتبعة في Git.
- `scripts/verify-empty-migration.mjs` ما زال يتوقع 79 جدولًا بدل 83.
- اختبار Sprint integration يفشل أثناء تنظيف المهام.
- FK الخاص بـ`sprint_analytics_events.task_id` يستخدم `ON DELETE RESTRICT`.

يجب تحديد سياسة الاحتفاظ بأحداث التحليلات ثم جعل اختبارات القاعدة الحالية والفارغة خضراء قبل الدمج.

### P0.3 إعداد Production Compose غير مكتمل

لا تُمرر إلى API متغيرات مهمة، منها:

- `AUTH_EMAIL_ENCRYPTION_KEY(S)`
- `ATTACHMENT_SCAN_MODE/URL/TOKEN`
- `TURNSTILE_SITE_KEY/SECRET_KEY`
- Integration OAuth client settings
- AI provider keys/models/pricing
- `TRUST_PROXY_HOPS`

كما توجد قيم تطويرية افتراضية لـ`AUTH_TOKEN_SECRET` وكلمات PostgreSQL/MinIO، ولا يشغّل container entrypoint فحص البيئة قبل الإقلاع.

## 5. P1 — مشاكل عالية الأهمية

1. Project-scoped RBAC لا يُطبّق بصورة موثوقة؛ `TenantGuard` يقرأ `projectId` من body/query فقط، لا من params.
2. النص العربي تالف في أجزاء واسعة، بما فيها metadata وSprints وSecurity وDashboard.
3. رحلة الدعوات ناقصة: لا توجد endpoints لقبولها أو إلغائها أو إعادة إرسالها.
4. Workspace export ليس تصديرًا كاملًا؛ لا يشمل Sprints، analytics وعدة جداول علاقات حديثة.
5. لا توجد آلية حذف حساب/مؤسسة أو retention policy مكتملة.
6. `format:check` يفشل في 46 ملفًا.
7. لا توجد Docker image build/scan/SBOM ضمن CI.

## 6. P2 — تحسينات متوسطة

- إكمال mentions وربطها بالإشعارات.
- واجهة reply threads حقيقية.
- جعل reactions تعتمد على user IDs بدل الأسماء.
- مزامنة فعلية مع GitHub/Slack/Calendars.
- توليد OpenAPI من controllers أو تحديثه ليغطي جميع endpoints.
- إضافة pagination افتراضية إلزامية.
- تفكيك `calmboard-app.tsx` و`task-views.tsx` وrepository المهام.
- نقل النصوص إلى translation catalog مركزي.
- إضافة اختبارات accessibility وresponsive.
- استبدال Quick Guide الثابت برحلة onboarding قابلة للتتبع.

## 7. P3 — تحسينات تنافسية

- Task/project template library قابلة للتخصيص.
- Favorites وRecent items.
- Custom workflow statuses.
- Portfolio/program management.
- Budgets، risks، milestones وresource forecasting.
- SCIM وSAML/enterprise SSO.
- Guest/public project sharing بحدود دقيقة.
- Mobile/offline workflow.
- قواعد notification granular.
- Automation builder متعدد الخطوات والفروع.

## 8. Security Findings

نقاط القوة:

- Argon2id، lockout، refresh rotation وsession revocation.
- MFA مشفر وOAuth PKCE.
- CSRF موقع ومقارنة timing-safe.
- Redis rate limiting يفشل مغلقًا في مسارات المصادقة.
- Webhook HMAC وتحقق replay.
- تشفير credentials.
- scanner يفشل مغلقًا في production.
- secret scanning وidempotency.

| الخطورة  | المشكلة                                                   |
| -------- | --------------------------------------------------------- |
| Critical | تغيير حالة الترخيص دون مصادقة                             |
| High     | عدم إدخال project path parameter في scope الخاص بـRBAC    |
| High     | Production Compose قد يقلع بأسرار تطويرية ودون validation |
| Medium   | صاحب `comments.manage` يستطيع تعديل/حذف تعليق عضو آخر     |
| Medium   | Worker يستخدم maintenance role مع `BYPASSRLS`             |
| Low      | بعض نتائج Security diagnostics ثابتة بدل فحص فعلي         |

## 9. Multi-Tenancy / RLS

التقييم: قوي مع ثغرة scope داخل المؤسسة.

- اختبار restricted runtime role نجح.
- 69 جدولًا خاضعًا لـRLS وفق الاختبار الحالي.
- جداول Sprints الأربعة تستخدم `ENABLE` و`FORCE RLS`.
- API runtime منفصل عن maintenance role في staging.
- repositories تكرر organization/workspace scoping كدفاع إضافي.

المشكلة الأساسية ليست تسريبًا عابرًا للمؤسسات، بل عدم تطبيق project-specific permission overrides على بعض مسارات URL.

## 10. Database / Performance

الإيجابيات:

- 83 جدولًا ونحو 173 index.
- PostgreSQL FTS وGIN/trigram indexes.
- optimistic concurrency، advisory locks و`SKIP LOCKED`.
- اختبار 100,000 مهمة نجح.
- usage limits ذرية تحت التزامن.

المخاطر:

- migration verification hardcoded على 79 جدولًا.
- FK analytics يتعارض مع تنظيف/حذف المهمة.
- بعض list APIs غير محدودة افتراضيًا.
- hydration الخاص بالمهام يحمّل عدة علاقات.
- `schema.ts` وrepository المهام كبيران جدًا.

## 11. API Quality

التقييم: جيد لكن غير متسق.

- validators allow-listed، idempotency، tenant guards وcorrelation IDs قوية.
- مسارات Sprints تبدأ بـ`/api/projects/...` خلاف معظم API.
- بعض controllers تتصل بالrepository مباشرة وأخرى تستخدم service.
- OpenAPI يدوي وجزئي.
- `Sprint not found` يعيد `400` بدل `404`.
- بعض params في move/remove لا تُستخدم بالكامل للتحقق.

## 12. Frontend Quality

- لا يوجد اتصال مباشر بقاعدة البيانات.
- فصل الخدمات والعمليات تحسن بصورة واضحة.
- يوجد Zustand وTanStack Query.
- معظم الشاشات تستعمل API حقيقيًا وليس بيانات وهمية.
- RTL، dark/light theme وmobile navigation موجودة.
- أكبر مشكلة حالية هي فساد encoding العربي المنتشر.
- التطبيق الأساسي Client-heavy وملف orchestration الرئيسي كبير.

## 13. Collaboration

- Comments/reactions/pinning موجودة.
- `parentId` موجود للردود لكن تجربة الرد المتداخل غير مكتملة.
- Mentions واجهة نصية فقط.
- Presence حقيقية ومعزولة.
- Realtime ينفذ invalidate/refetch ولا يقدم تحريرًا تعاونيًا مباشرًا.

## 14. Notifications

- Inbox، read state، preferences، email outbox، digests وretries موجودة.
- لا توجد mention notifications حقيقية.
- لا توجد مصفوفة granular لكل event/channel.
- لا يوجد push notification.
- invitation email lifecycle غير مكتمل.

## 15. Search

الحالة COMPLETE:

- بحث عبر tasks/projects/docs/comments/users/teams/attachments.
- Ranking، exact-prefix boost، typo tolerance وsubstring fallback.
- حدود نتائج واستعلام.
- عزل tenant وdocument permissions.
- فهارس GIN وpg_trgm.

## 16. Attachments / Storage

التنفيذ البرمجي قوي: signed URLs، tenant-scoped keys، validation، metadata verification، malware scanner fail-closed، previews وcleanup.

لكن الميزة غير قابلة للتشغيل في Docker production حتى تمرير إعداد scanner وإدخاله في startup validation.

## 17. Automations / Workers

الحالة COMPLETE ضمن نطاق الإجراءات الحالية:

- عشرة jobs مجدولة تقريبًا.
- retries وexponential backoff.
- dead-letter queue.
- claim tokens و`SKIP LOCKED`.
- deduplication وعمق أقصى لمنع الحلقات.
- لوحة Admin لإعادة المحاولة.

## 18. Observability

- API/Worker metrics.
- health/liveness/readiness.
- correlation IDs.
- Sentry وprofiling.
- OpenTelemetry وTempo.
- Prometheus وAlertmanager وقواعد alerts.

المتبقي تشغيليًا: اختبار إرسال alert فعلي وربطه بالـon-call.

## 19. Deployment

- Dockerfiles متعددة المراحل وغير root.
- staging يستعمل app role بلا `BYPASSRLS`.
- migrations منفصلة قبل التطبيقات.
- الخدمات المحلية الافتراضية PostgreSQL/Redis/MinIO.
- CI لا يبني صور Docker ولا يفحصها.
- wiring متغيرات البيئة داخل Compose غير مكتمل.
- تعليمات README المحلية لا تتطابق بالكامل مع profiles الحالية.

## 20. Backup / Recovery

السكربتات جيدة نظريًا: pg_dump، object storage، تشفير Age، checksum، وجهة مستقلة وrestore stack معزول.

لم يُنفذ backup/restore drill فعلي في هذا التدقيق لعدم توفر وجهة backup ومفاتيح Age. التنفيذ البرمجي COMPLETE، والجاهزية التشغيلية PARTIAL حتى نجاح drill موثق مع RPO/RTO.

## 21. Onboarding

- التسجيل ينشئ organization/workspace.
- Quick Guide وقوالب المشاريع موجودان.
- لا توجد checklist متتبعة أو progress events.
- رحلة دعوة العضو غير مكتملة.

## 22. Commercial SaaS Readiness

موجود: plans/subscriptions/invoices، Stripe checkout/portal/webhooks، trials/grace/cancellation، usage limits وAI accounting.

ناقص: account/org deletion، complete portability export، tax/invoice compliance، entitlement UX، customer support tooling، dunning communication، SSO/SCIM وprivacy/retention controls.

## 23. Accessibility / RTL / Responsive

الإيجابي: `lang` و`dir` ديناميكيان، focus-visible styles، aria labels، sidebar وmobile navigation.

المشاكل:

- فساد النصوص العربية يجعل RTL غير مقبول في شاشات عديدة.
- لا توجد اختبارات axe/WCAG.
- لم تُثبت keyboard navigation للـdrag/drop والجداول المعقدة.
- لا توجد visual regression متعددة الأحجام.

## 24. Testing Gaps

| الفحص                          | النتيجة                                          |
| ------------------------------ | ------------------------------------------------ |
| `db:check`                     | PASS                                             |
| `typecheck`                    | PASS — 10 packages                               |
| `lint`                         | PASS                                             |
| unit/regression tests          | PASS                                             |
| production build               | PASS                                             |
| environment check              | PASS                                             |
| tracked secret scan            | PASS                                             |
| circular dependency check      | PASS — 513 files                                 |
| Docker Compose config          | PASS مع تحذير صلاحية Docker config المحلي        |
| `format:check`                 | FAIL — 46 ملفًا                                  |
| current migration verification | FAIL — 32/33 integration                         |
| empty migration verification   | FAIL — 83 جدولًا مقابل expected 79               |
| E2E                            | لم يُشغّل؛ web/API لم يكونا عاملين على 3000/4000 |
| Accessibility automation       | غير موجود                                        |
| Docker image build/scan        | غير موجود في CI                                  |
| Backup restore drill           | غير منفذ تشغيليًا                                |

## 25. Dead / Duplicate / Legacy Code

- ملفات مؤقتة غير متتبعة في الجذر مثل `kill.js`, `search.js`, `test_drizzle.ts`, `verify-0059.js`, `verify-0060.js`.
- ملفات Sprints كاملة غير متتبعة، فلا يمكن اعتبارها جزءًا من release artifact.
- README ما زال يصف Auth/Form Builder قديمًا كـmock.
- OpenAPI اليدوي متأخر عن التنفيذ.
- منطق الواجهة موزع بين orchestrator ضخم وhooks عديدة مع تكرار نصوص الترجمة.

## 26. Recommended Feature Gaps

1. Invitation acceptance lifecycle.
2. Mentions + notification routing.
3. Account deletion وcomplete data export.
4. Task templates وcustom workflows.
5. Favorites/recent items.
6. Real integration sync.
7. SSO/SCIM.
8. Project sharing والـguest access.
9. Portfolio/risk/budget management.
10. Advanced automation branching.

## 27. Recommended Roadmap

### Milestone 1 — Release Safety

إغلاق ثغرة الترخيص، تصحيح Docker env wiring، فرض startup validation، تثبيت Sprints migrations والاختبارات وجعل جميع البوابات خضراء.

### Milestone 2 — Arabic and Tenant Authorization

إصلاح encoding، تدقيق project-scoped RBAC وتشغيل tenant/permission regression matrix.

### Milestone 3 — Collaboration and Onboarding

دعوات كاملة، mentions، replies، granular notifications وonboarding checklist.

### Milestone 4 — SaaS Operations

Complete export، account/org deletion، retention، Stripe staging verification، Docker image CI وbackup restore drill.

### Milestone 5 — Competitive Depth

Templates، favorites، custom workflows، portfolio management، SSO/SCIM والتكاملات الفعلية.

## 28. Suggested Next 5 Milestones

1. **P0 Security & Deployment Gate**
2. **Sprints Stabilization & Migration Completion**
3. **Arabic Encoding + Project RBAC**
4. **Invitations, Mentions & Notifications**
5. **Data Lifecycle, SaaS Operations & Production Drill**

## النتيجة النهائية

المشروع يمتلك أساسًا قويًا وميزات كثيرة مكتملة فعليًا، لكنه يحتاج دفعة تثبيت وإطلاق قبل إضافة ميزات جديدة. أخطر ما يجب معالجته أولًا هو الترخيص العام، تكامل Sprints غير المكتمل، وإعداد Docker الإنتاجي.

حالة عمليات التدقيق عند إنشاء هذا التقرير:

- **New migration created: NO**
- **Backfill executed: NO**
- **Schema modified: NO**
- **Source implementation modified during audit: NO**
