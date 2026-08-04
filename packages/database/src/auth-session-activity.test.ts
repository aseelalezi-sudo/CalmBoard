import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ACTIVITY_TOUCH_INTERVAL_MS, sessionActivityIsStale } from "./repositories/auth-sessions.js";

test("session activity avoids a write within the touch interval", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  assert.equal(sessionActivityIsStale(new Date(now.getTime() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS + 1), now), false);
});

test("session activity is refreshed at the interval boundary", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  assert.equal(sessionActivityIsStale(new Date(now.getTime() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS), now), true);
});
