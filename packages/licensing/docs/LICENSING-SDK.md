# CalmBoard Licensing SDK

نظام تفويض الترخيص لـ **CalmBoard** عبر خادم **LicenseHub**: تحقق محلي **بلا اتصال** + تحقق **حي**، بتوقيع **JWT EdDSA (Ed25519)**، وتشفير الحالة **AES-256-GCM**، بلا أي تبعيات خارجية.

الحزمة: `packages/licensing` — `@calmboard/licensing`

---

## 1. المتطلبات التي يغطيها النظام

| المتطلب                           | التحقيق                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| تفعيل البرنامج بمفتاح ترخيص       | `boot()` / `activate()` مقابل `/licenses/activate` + `/validate`                                         |
| ربط الترخيص بجهاز المستخدم        | `createDeviceFingerprint()` (مضيف/MAC/machine-id + salt مُخزّن) ثم `devf = HMAC(fingerprint, secret)`    |
| تحقق أونلاين وأوفلاين + فترة سماح | تحقق توقيع محلي كامل؛ انقطاع الشبكة → `grace_period` (حتى `GRACE_SECONDS` بعد آخر تحقق)                  |
| تشفير ومنع التلاعب                | التوقيع يمنع عبث التوكن؛ `EncryptedFileLicenseStore` يشفّر حالة الترخيص ويرفض أي تحريف (GCM auth)        |
| إدارة أنواع التراخيص              | `describeLicense()`/`isType()` (تجريبي/شهري/سنوي/دائم) استناداً إلى `typ` و`exp`                         |
| إلغاء/تعطيل من لوحة LicenseHub    | اكتشاف `403/forbidden` عند التحقق؛ فحص دوري `revalidationIntervalSeconds` يلتقط الإلغاء حتى مع توكن سليم |
| إعادة الاستخدام في مشروع آخر      | حزمة مستقلة `@calmboard/licensing` بلا اعتماد على NestJS                                                 |

---

## 2. متغيرات البيئة

| Variable                                 | وصف                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `CALMBOARD_LICENSE_SERVER_URL`           | جذر API الخاص بـ LicenseHub، مثال `http://127.0.0.1:8080/api/v1`    |
| `CALMBOARD_LICENSE_DEVICE_HASH_SECRET`   | سر HMAC (مساوي `LICENSE_DEVICE_HASH_SECRET` بخادم)                  |
| `CALMBOARD_LICENSE_ISSUER`               | `licensehub`                                                        |
| `CALMBOARD_LICENSE_PRODUCT`              | `calmboard`                                                         |
| `CALMBOARD_LICENSE_KEY`                  | مفتاح الترخيص، مثال `LHB-GYBF-3TUR-DT2C-CYUE`                       |
| `CALMBOARD_LICENSE_ENFORCED`             | `true` لتفعيل فرض الترخيص داخل NestJS (الافتراضي `false` = بلا فرض) |
| `CALMBOARD_LICENSE_STORE_SECRET`         | مفتاح تشفير الحالة (AES-256-GCM)                                    |
| `CALMBOARD_LICENSE_STORE_FILE`           | مسار ملف الحالة المشفّر                                             |
| `CALMBOARD_LICENSE_GRACE_SECONDS`        | فترة السماح عند انقطاع الشبكة (الافتراضي 604800 = 7 أيام)           |
| `CALMBOARD_LICENSE_REVALIDATION_SECONDS` | فاصل إعادة التحقق لاكتشاف الإلغاء (الافتراضي 86400 = 24 س)          |
| `CALMBOARD_LICENSE_TIMEOUT_MS`           | مهلة طلبات الشبكة (الافتراضي 5000)                                  |

أُدرجت جميع الأسماء في `turbo.json → globalEnv` وفي `.env.example`.

---

## 3. الاستخدام الكلاسيكي (خارج NestJS)

```ts
import { createLicensing, EncryptedFileLicenseStore, describeLicense } from "@calmboard/licensing";

const licensing = createLicensing({
  serverUrl: process.env.CALMBOARD_LICENSE_SERVER_URL!,
  licenseKey: process.env.CALMBOARD_LICENSE_KEY,
  product: process.env.CALMBOARD_LICENSE_PRODUCT!,
  deviceHashSecret: process.env.CALMBOARD_LICENSE_DEVICE_HASH_SECRET!,
  issuer: process.env.CALMBOARD_LICENSE_ISSUER ?? "licensehub",
  graceSeconds: 7 * 24 * 60 * 60,
  store: new EncryptedFileLicenseStore("./license.enc", process.env.CALMBOARD_LICENSE_STORE_SECRET!),
});

const { valid, status, grace, claims } = await licensing.boot();

if (valid) {
  const type = describeLicense(claims).label; // "Trial" / "Monthly" / ...
  const features = claims.fea; // ["advanced-reports", ...]
} else if (status === "revoked") {
  // عطّل الخدمة فوراً
} else if (status === "grace_expired" || status === "offline") {
  // لا يوجد رخصة صالحة
}
```

## 4. الدمج داخل NestJS (الجاهز)

تم دمج الحزمة في `apps/api` عبر:

- `apps/api/src/licensing/licensing.module.ts` — يوفّر `LicensingService` + `LicensingGuard`.
- `licensing.service.ts` — يبني العميل من المتغيرات، يفحص عند الإقلاع، ويخزّن نتيجة لـ 30 ثانية.
- `licensing.guard.ts` — حارس عام (`APP_GUARD`): يتخطى الخدمات `@PublicRoute()`، وإلا يرفض (402/403/503).
- `licensing.controller.ts` — نقاط `GET /licensing/status` و `POST /licensing/refresh` و `POST /licensing/activate` و `POST /licensing/deactivate`.

`POST /licensing/activate` يقبل `{ "license_key": "..." }` لتفعيل العتاد البرمجي بمفتاح يُدخله المستخدم (يُخزَّن لاحقاً عبر `LicenseService.activateKey`)، و`POST /licensing/deactivate` يحرّر المقعد. مثل كل النقاط، معلّة `@PublicRoute()` (لا تحتاج مصادقة) لتسمح لصفحة الترخيص بالعمل.

أُدخل الحارس في `app.module.ts` كأول `APP_GUARD`. لتفعيل الفرض: ضع `CALMBOARD_LICENSE_ENFORCED=true` ويكون الخادم منظماً على LicenseHub.

## 5. الواجهات المصدّرة

- `LicenseService.boot/activate/validate/heartbeat/deactivate/refreshKeys`
- `LicenseCheck` (مع `grace`) و`LicenseStatus` (`valid`, `grace_period`, `grace_expired`, ...)
- `createDeviceFingerprint` , `EncryptedFileLicenseStore` , `describeLicense`/`isType`
- `crypto`: `verifySignature`, `hmacSha256`, `aes-gcm`, `digestsEqual`, ...

## 6. البناء والاختبار

```sh
pnpm --filter @calmboard/licensing typecheck
pnpm --filter @calmboard/licensing build
pnpm --filter @calmboard/licensing test      # 26 اختباراً (crypto + service + features)
# اختبار حارس NestJS:
npx tsx --test src/licensing/licensing.guard.test.ts   # من apps/api
```

## 7. إعادة الاستخدام في مشروع آخر

- الحزمة «Node فقط» بلا اعتماد NestJS: انقل `packages/licensing` أو انشره كحزمة.
- كل ما تحتاجه: `serverUrl`، `product`، `deviceHashSecret`، ومفتاح عام من `GET /keys` (يُخزَّن تلقائياً في `publicKeys`).
- اختر المخزن: `MemoryLicenseStore`/`FileLicenseStore`/`EncryptedFileLicenseStore`.
- لجمع سادس: استخدم `createDeviceFingerprint` أو مرّر `fingerprint: () => ...` مخصصاً.

ملاحظة: `CALMBOARD_LICENSE_*` سرّ البيانات عن الحالات نفسها؛ المفتاح العام هو ما يسمح للعميل بالتحقق بلا اتصال. كل ما يرسله الخادم يُوقَّع بهذا المفتاح الخاص، لذا لا يمكن لأي عميل توليد رخصة صالحة.
