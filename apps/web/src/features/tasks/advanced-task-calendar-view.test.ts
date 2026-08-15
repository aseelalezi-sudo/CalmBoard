import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./advanced-task-calendar.tsx", import.meta.url), "utf8");

test("advanced calendar uses RTL-aware navigation, localized counts, and semantic ranges", () => {
  assert.match(source, /<SegmentedTabs/);
  assert.match(source, /ctx\.locale === "ar" \? "›" : "‹"/);
  assert.match(source, /ctx\.locale === "ar" \? "‹" : "›"/);
  assert.match(source, /fmtNumber\(day\.getDate\(\), ctx\.locale\)/);
  assert.match(source, /fmtNumber\(dayTasks\.length, ctx\.locale\)/);
  assert.match(source, /border-e border-b border-line/);
  assert.match(source, /isSameDay\(day, today\) && "bg-accent\/5"/);
  assert.match(source, /focus-visible:opacity-100/);
  assert.match(source, /border border-accent\/30 bg-surface/);
  assert.doesNotMatch(source, /dayTasks\.length\} \{ctx\.t\("مهمة"/);
});
