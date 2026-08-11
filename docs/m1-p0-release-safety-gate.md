# M1 P0 Release Safety Gate

تاريخ التحقق: 2026-08-09
القرار النهائي: **GO — جميع بوابات P0 المطلوبة ناجحة**

هذا التقرير يغطي إصلاحات سلامة الإصدار فقط. لم تُنفذ أي ميزة من M2 أو البنود المؤجلة في التدقيق الكامل.

## P0.1 Licensing

### الخطر الأصلي

كان `@PublicRoute()` موضوعاً على `LicensingController` كاملاً، لذلك كانت عمليات `activate` و`refresh` و`deactivate` تتجاوز المصادقة والتفويض.

### تصميم التفويض النهائي

- بقي `GET /licensing/status` عاماً لأنه للقراءة فقط ويعرض حالة محدودة.
- تتطلب عمليات التغيير الثلاث جلسة مصادقاً عليها و`PlatformAdmin` وCSRF.
- أضيف `@SkipLicenseCheck()` مستقل عن `@PublicRoute()`؛ يسمح لمدير المنصة بإصلاح رخصة غير مفعلة أو منتهية من دون تعطيل `AuthGuard` أو `PlatformAdminGuard`.
- لا يوجد shared secret جديد ولا استخدام لـCSRF كبديل للمصادقة.
- عند تفعيل الترخيص في الإنتاج، يلزم server URL وdevice secret ومخزن مشفر دائم. يخزن Compose الحالة في volume باسم `license_state`.

### المسارات والاختبارات

- عُدلت `apps/api/src/licensing/licensing.controller.ts` و`licensing.guard.ts`.
- أضيف اختبار يثبت أن الحالة وحدها عامة وأن الاتصال المباشر غير المصادق عليه يُرفض قبل تنفيذ أي mutation.
- اختبارات API: **147/147 PASS** ضمن بوابة CI النهائية.

## Sprint Release Integration

### ملفات الإصدار المطلوبة

- Database: migrations `0057`–`0060`، snapshots المقابلة، journal، schema، مستودعا `sprints` و`sprint-analytics`، استعلامات analytics واختبار التكامل.
- API: Sprint validation/service/controller وSprint analytics validation/service/controller واختباراتهما وتسجيل المتحكمات في `AppModule`.
- Web: مجلد `features/sprints` كاملاً، Reports/analytics، تعديلات navigation وshell وworkspace actions/types، ومبدلات المشروع/مساحة العمل اللازمة للوصول إلى النطاق الصحيح.
- تكامل المشروع: تعديلات project validation/repository/service والاختبارات اللازمة لعلاقات Sprint.

هذه الملفات ما زالت ظاهرة كملفات جديدة في worktree لأن هذه المراجعة لا تغيّر Git index تلقائياً؛ يجب تضمينها كلها في commit الإصدار.

### الملفات المؤقتة

راجعت وأزلت من مجموعة الإصدار: `kill.js`, `search.js`, `test_drizzle.ts`, `verify-0059.js`, `verify-0060.js`, `verify-analytics-capture.ts`, `diff-utf8.txt`. كانت scripts/debug artifacts ذات مسارات أو بيانات تطوير ثابتة، وأصبحت التحققات المفيدة منها مغطاة باختبارات المستودع الرسمية.

## Migration Verification

- تسلسل journal متصل من `0000_baseline` حتى `0060_sprint_analytics_event_ordering`.
- عدد الترحيلات المنفذة: **61**.
- عدد جداول `public`: **83**، وتطابق أسماؤها snapshot 0060 تماماً.
- الجداول الأربعة المضافة هي فقط: `sprints`, `task_sprint_assignments`, `sprint_snapshots`, `sprint_analytics_events`.
- فحص القاعدة النظيفة يثبت بالاسم وجود الجداول والفهارس والقيود الخاصة بـSprint، ووجود سياسة tenant واحدة مع `ENABLE/FORCE RLS` على الجداول الأربعة.
- تحقق Drizzle من تطابق schema: **PASS**.
- قاعدة نظيفة مع الاختبارات والت seed: **PASS**.

## Sprint Integration Failure

### السبب وسياسة الإنتاج

يحمي FK `sprint_analytics_events.task_id` التاريخ التحليلي بـ`ON DELETE RESTRICT`. الإنتاج يستخدم `tasks.softDelete()`، يفصل المهمة عن Sprint ويضيف حدث `task_removed` عند الحاجة، ولا يحذف تاريخ analytics.

كان الفشل محصوراً في teardown للاختبار: كان يحذف Task فعلياً قبل حذف السجل التاريخي الذي أنشأه fixture نفسه.

### الإصلاح والاختبارات

عُدل teardown ليحذف `sprint_analytics_events` ثم `sprint_snapshots` ثم assignments قبل Tasks/Sprints. لم تُضعف سلامة FK ولم يتغير migration 0059. اختبار Sprint المنفرد وبوابتا current/pristine migration: **PASS**.

## Production Environment

توجد بوابة startup داخل صورتي API وWorker تستدعي `scripts/check-env.mjs` بنطاق خدمة مستقل قبل تشغيل التطبيق. غياب إعداد إلزامي يُخرج العملية بالرمز 1 من دون طباعة قيمة سرية. جُرب ذلك فعلياً داخل الصورتين.

### مصفوفة الربط

| Variable                                                                                          | Consumer              | مطلوب في الإنتاج؟                            | Compose                | Startup validation               | حساس؟                |
| ------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------- | ---------------------- | -------------------------------- | -------------------- |
| `DATABASE_URL`                                                                                    | API/Worker/migrations | نعم                                          | نعم                    | نعم                              | نعم                  |
| `DATABASE_APP_URL`                                                                                | API                   | نعم، بدور `NOBYPASSRLS` مستقل                | نعم                    | نعم ويُرفض تطابقه مع URL الصيانة | نعم                  |
| `DATABASE_MAINTENANCE_URL`                                                                        | Worker                | نعم                                          | نعم                    | نعم                              | نعم                  |
| `REDIS_URL`                                                                                       | API/Worker            | نعم                                          | نعم                    | نعم                              | نعم                  |
| `APP_URL`, `API_PUBLIC_URL`                                                                       | API/Web               | نعم                                          | نعم                    | نعم للـAPI                       | لا                   |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_REALTIME_URL`                                                 | Web build             | نعم                                          | نعم كـbuild args       | وقت البناء                       | لا                   |
| `AUTH_TOKEN_SECRET`                                                                               | API                   | نعم، ثابت و32 بايت فأكثر                     | نعم بلا default إنتاجي | نعم                              | نعم                  |
| `AUTH_COOKIE_SECURE`                                                                              | API                   | نعم للـHTTPS                                 | نعم                    | سلوك آمن افتراضياً               | لا                   |
| `AUTH_EMAIL_ENCRYPTION_KEY(S)`                                                                    | API/Worker            | نعم                                          | نعم                    | نعم                              | نعم                  |
| `MFA_ENCRYPTION_KEY(S)`                                                                           | API                   | نعم                                          | نعم                    | نعم                              | نعم                  |
| `INTEGRATION_CREDENTIALS_KEY(S)`                                                                  | API                   | نعم                                          | نعم                    | نعم                              | نعم                  |
| `WEBHOOK_SIGNING_SECRET`                                                                          | API                   | نعم                                          | نعم بلا default إنتاجي | نعم                              | نعم                  |
| `INTEGRATION_GITHUB_WEBHOOK_SECRET`, `INTEGRATION_SLACK_SIGNING_SECRET`                           | API                   | عند استخدام receiver المقابل                 | نعم                    | runtime feature validation       | نعم                  |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`                                     | API/Worker            | نعم عدا region ذي default ثابت               | نعم                    | نعم للقيم الجوهرية               | جزئياً               |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                                        | API/Worker            | نعم                                          | نعم                    | نعم ومنع قيم التطوير             | نعم                  |
| `ATTACHMENT_SCAN_MODE`, `ATTACHMENT_SCANNER_URL`, `ATTACHMENT_SCANNER_TOKEN`                      | API                   | نعم؛ mode=`webhook`                          | نعم                    | نعم                              | token حساس           |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAMES`                      | API/public forms      | المفتاحان مطلوبان؛ hostnames اختياري موصى به | نعم                    | نعم للمفتاحين                    | secret حساس          |
| `TRUST_PROXY_HOPS`                                                                                | API                   | نعم وقيمة 0–10                               | نعم                    | نعم                              | لا                   |
| `METRICS_BEARER_TOKEN`                                                                            | API/Worker            | نعم و32 بايت فأكثر                           | نعم                    | نعم                              | نعم                  |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                             | Worker                | نعم                                          | نعم                    | نعم                              | API key حساس         |
| `AUTH_*_OAUTH_ENABLED` + Google/Microsoft client config                                           | API                   | config مطلوب عند تفعيل المزود فقط            | نعم                    | شرطي                             | client secrets حساسة |
| `INTEGRATION_*_OAUTH_ENABLED` + client IDs/secrets/scopes/tenant                                  | API                   | config مطلوب عند تفعيل المزود فقط            | نعم                    | شرطي                             | client secrets حساسة |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_MODEL_PRICING_JSON` | API                   | مطلوب فقط للمزود المضبوط                     | نعم                    | شرطي مع تحقق pricing             | المفاتيح حساسة       |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_GRACE_PERIOD_DAYS`                          | API                   | webhook secret مطلوب عند وجود Stripe key     | نعم                    | شرطي                             | المفاتيح حساسة       |
| `CALMBOARD_LICENSE_ENFORCED` ومجموعة `CALMBOARD_LICENSE_*`                                        | API                   | المجموعة مطلوبة فقط عند enforcement=true     | نعم                    | شرطي؛ store secret ≥32 بايت      | key/secrets حساسة    |
| `SENTRY_*`, `ENABLE_OTEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`                                          | API/Worker/Web        | اختيارية؛ endpoint مطلوب عند تفعيل OTEL      | نعم                    | شرطي                             | DSN عادة غير سري     |
| `SEARCH_PROVIDER`, `CALMBOARD_QUEUE_NAME`, `API_GENERAL_RATE_LIMIT`, pool/port/log options        | API/Worker            | تشغيلية مع defaults مقيدة                    | نعم                    | parser/runtime bounds            | لا                   |
| Worker interval/batch/claim/retention options                                                     | Worker                | تشغيلية مع defaults مقيدة                    | نعم                    | parser/runtime bounds            | لا                   |

لا يحتوي Git على قيم أسرار حقيقية. `deploy/secrets.example.env` قالب أسماء وقيم placeholder فقط، ويُمرر الملف الحقيقي من secret manager أو ملف خارجي محمي.

## Attachments / Turnstile

- Scanner disabled/misconfigured في production: **fail closed**.
- Scanner unavailable أو timeout أو HTTP rejection: **fail closed**.
- verdict غير صالح: **fail closed**؛ `infected` لا يعامل كـclean.
- Turnstile عند طلب CAPTCHA بلا مفاتيح production: **fail closed**.
- مفاتيح scanner وTurnstile موصولة في base Compose وstaging overlay.

## Repository Gates

| Gate                        | Result                                                   |
| --------------------------- | -------------------------------------------------------- |
| `check:env` / startup tests | PASS                                                     |
| `check:secrets`             | PASS                                                     |
| `db:check`                  | PASS                                                     |
| `db:migrate:verify-current` | PASS — 33 DB + 9 API integration tests                   |
| `db:migrate:verify`         | PASS — 83 tables / 61 migrations / integration + workers |
| RLS / tenant isolation      | PASS                                                     |
| Typecheck                   | PASS — 10 packages                                       |
| Lint                        | PASS — 10 packages                                       |
| Format                      | PASS                                                     |
| Unit/package tests          | PASS                                                     |
| Production build            | PASS — Web/API/Worker and shared packages                |
| `git diff --check`          | PASS                                                     |

ملاحظة غير معطلة: عرض Next.js أثناء البناء تحذير Node deprecation لـ`module.register()` صادر من سلسلة الأدوات، ولم ينتج عنه فشل أو سلوك إصدار.

## Docker

- base Compose config: **PASS**.
- base + staging overlay config: **PASS**.
- Docker Engine المستخدم: `29.6.2`.
- بناء الصور الفعلي: `calmboard-web`, `calmboard-api`, `calmboard-worker` — **PASS**.
- تشغيل API/Worker بلا أسرار: كلاهما رفض الإقلاع مبكراً بالرمز 1 — **PASS**.
- topology الموثقة: `client -> trusted TLS reverse proxy/load balancer -> API` تعني `TRUST_PROXY_HOPS=1`؛ لا تُزاد القيمة إلا عند إضافة proxy موثوق فعلياً.

## Database

**New migration created: NO**
**Backfill executed: NO**

لم تُعدل ملفات SQL من 0057 إلى 0060.

## Deferred

كل عناصر P1/P2/P3 وMentions وInvitation lifecycle وBackfill وCapacity وBurnup وTask templates وFavorites وCustom workflows وSSO/SCIM وأي features/analytics جديدة بقيت دون تغيير. لا يبدأ M2 ضمن هذا العمل.
