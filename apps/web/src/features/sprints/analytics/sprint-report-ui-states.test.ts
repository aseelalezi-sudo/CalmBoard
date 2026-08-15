import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overview = readFileSync(new URL("./reports-overview.tsx", import.meta.url), "utf8");
const burndown = readFileSync(new URL("./burndown-view.tsx", import.meta.url), "utf8");
const velocity = readFileSync(new URL("./velocity-view.tsx", import.meta.url), "utf8");
const summary = readFileSync(new URL("./sprint-summary-card.tsx", import.meta.url), "utf8");

test("burndown distinguishes sprint-list and timeline failures without unsafe payload casts", () => {
  assert.match(burndown, /if \(sprintQuery\.isError\)/);
  assert.match(burndown, /isAnalyticsIntegrityError\(query\.error\)/);
  assert.match(burndown, /sprintQuery\.refetch\(\)/);
  assert.doesNotMatch(burndown, /as any/);
});

test("burndown uses a real SVG coordinate system and keyboard-readable points", () => {
  assert.match(burndown, /viewBox="0 0 100 100"/);
  assert.match(burndown, /role="img"/);
  assert.match(burndown, /tabIndex=\{0\}/);
  assert.match(burndown, /group-focus-within:opacity-100/);
  assert.match(burndown, /Math\.max\(560, series\.length \* 64\)/);
});

test("velocity provides keyboard-readable bars and native mobile history cards", () => {
  assert.match(velocity, /role="img"/);
  assert.match(velocity, /group-focus-within:opacity-100/);
  assert.match(velocity, /grid gap-2 md:hidden/);
  assert.match(velocity, /hidden overflow-x-auto[\s\S]*md:block/);
  assert.match(velocity, /fmtNumber\(sprint\.completedStoryPoints, ctx\.locale\)/);
});

test("overview and summary metrics use localized values and semantic surfaces", () => {
  assert.match(overview, /fmtNumber\(val, ctx\.locale/);
  assert.match(overview, /fmtNumber\(data\.completedSprints, ctx\.locale\)/);
  assert.match(summary, /formatSprintMetric\(Math\.round\(summary\.completionRatio \* 100\), ctx\.locale\)/);
  assert.match(summary, /bg-surface/);
});
