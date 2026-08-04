import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("primary admin, integration, and AI screens do not present locally simulated operational data", async () => {
  const [controls, adminPage, integrations, aiAdapter, aiPanel] = await Promise.all([
    source("../../components/admin-controls.tsx"),
    source("../../app/admin/page.tsx"),
    source("../integrations/integrations-view.tsx"),
    source("../../../../api/src/ai-provider.ts"),
    source("../ai/ai-panel.tsx"),
  ]);

  assert.match(controls, /useAdminQueues\(\)/);
  assert.doesNotMatch(controls, /Feature flags simulation|Org status simulation|suspendedOrgs|impersonating/);
  assert.doesNotMatch(adminPage, /const mrr|حالة الخدمات|\["API", "تشغيل"\]/);
  assert.match(integrations, /credential\?\.lastUsedAt/);
  assert.doesNotMatch(integrations, /syncCount|useState\(/);
  assert.match(aiAdapter, /throw new AIProviderUnavailableError/);
  assert.doesNotMatch(aiAdapter, /Turnkey Intelligent Simulation|نسبة الإنجاز العامة|مهمة مولدة بالذكاء الاصطناعي/);
  assert.doesNotMatch(aiPanel, /3 مهام معرضة|project at 62%|live-dot/);
});
