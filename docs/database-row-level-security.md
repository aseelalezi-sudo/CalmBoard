# PostgreSQL Row-Level Security

يفصل التطبيق بين اتصالين بقاعدة البيانات:

- `DATABASE_URL`: حساب مالك/ترحيل لتطبيق Drizzle migrations وأعمال الصيانة فقط.
- `DATABASE_APP_URL`: حساب تشغيل محدود تستخدمه API، ويجب أن يكون `NOSUPERUSER` و`NOBYPASSRLS` وألا يملك الجداول.

ينشئ مسؤول قاعدة البيانات حساب التشغيل مرة واحدة، بعد استبدال الاسم وكلمة المرور واسم القاعدة:

```sql
CREATE ROLE calmboard_app
  LOGIN PASSWORD 'replace-with-a-secret'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

GRANT CONNECT ON DATABASE calmboard TO calmboard_app;
GRANT USAGE ON SCHEMA public TO calmboard_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO calmboard_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO calmboard_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO calmboard_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO calmboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO calmboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO calmboard_app;
```

بعد ذلك تُضبط قيمة `DATABASE_APP_URL` بهذا الحساب. يرفض فحص البيئة الإنتاجية استخدام رابط الترحيل نفسه كرابط تشغيل، لأن حسابات `SUPERUSER` أو `BYPASSRLS` تتجاوز سياسات RLS حتى عند استخدام `FORCE ROW LEVEL SECURITY`.

تضبط API المتغيرات `app.organization_id` و`app.workspace_id` و`app.actor_id` باستخدام `set_config(..., true)` داخل transaction خاصة بكل طلب. القيمة `true` تجعل السياق محلياً للمعاملة ويمنع تسربه إلى طلب آخر عند إعادة استخدام اتصال من pool.
