import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(name: string) {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

describe("support overlays", () => {
  it("uses the real readiness endpoint instead of simulated telemetry", () => {
    const telemetry = source("telemetry-modal.tsx");
    assert.match(telemetry, /apiServiceUrl\("\/health\/readiness"\)/);
    assert.match(telemetry, /requestJson<ReadinessResponse>/);
    assert.doesNotMatch(telemetry, /Math\.random|setInterval|initialLogs|99\.98%|cacheHitRate/);
    assert.match(telemetry, /it does not estimate uptime, latency, or cache hit rate/);
  });

  it("makes readiness loading and failure recoverable without stale results", () => {
    const telemetry = source("telemetry-modal.tsx");
    assert.match(telemetry, /const requestId = \+\+requestIdRef\.current/);
    assert.match(telemetry, /if \(requestId !== requestIdRef\.current\) return/);
    assert.match(telemetry, /tone="loading"/);
    assert.match(telemetry, /tone="error"/);
    assert.match(telemetry, /onClick=\{\(\) => void load\(\)\}/);
    assert.match(telemetry, /closeLabel=\{t\("إغلاق", "Close"\)\}/);
  });

  it("keeps the quick guide role-neutral, localized, and mobile safe", () => {
    const guide = source("quick-guide.tsx");
    assert.doesNotMatch(guide, /href="\/admin"|Super Admin Panel|\/admin\)/);
    assert.match(guide, /t\(s\.badge_ar, s\.badge_en\)/);
    assert.match(guide, /size="wide"/);
    assert.match(guide, /className="w-full px-5 sm:w-auto"/);
    assert.match(guide, /href="\/api-reference"/);
  });

  it("documents cross-platform shortcuts without installing a duplicate listener", () => {
    const shortcuts = source("keyboard-shortcuts.tsx");
    assert.doesNotMatch(shortcuts, /addEventListener|useEffect/);
    assert.match(shortcuts, /Ctrl\/⌘/);
    assert.match(shortcuts, /closeLabel=\{t\("إغلاق", "Close"\)\}/);
    assert.match(shortcuts, /<Btn variant="primary" onClick=\{onClose\}/);
    assert.match(shortcuts, /flex flex-col gap-3/);
  });
});
