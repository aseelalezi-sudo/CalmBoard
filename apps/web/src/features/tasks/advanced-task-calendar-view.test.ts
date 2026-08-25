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

test("advanced calendar enforces filter propagation, authoritative dataset, and no ctx.tasks leakage", () => {
  // Propagates common view filters into getCalendarTasks
  assert.match(source, /\.\.\.commonFilters/);
  assert.match(source, /search:\s*searchFilter/);
  assert.match(source, /status:\s*statusFilter/);
  assert.match(source, /priority:\s*priorityFilter/);
  assert.match(source, /assigneeId:\s*assigneeFilter/);

  // Authoritatively derives from calendarTasks without merging ctx.tasks
  assert.doesNotMatch(source, /for\s*\(\s*const\s+task\s+of\s+ctx\.tasks\s*\)/);
  assert.match(source, /for\s*\(\s*const\s+task\s+of\s+calendarTasks\s*\)/);
  assert.match(source, /matchesTaskFilters\(task,\s*commonFilters\)/);

  // Uses authoritative calendar timezone
  assert.match(source, /calendarTimezone\s*=\s*"UTC"/);
  assert.match(source, /visibleCalendarQueryRange\(anchor,\s*mode,\s*weekStartsOn,\s*calendarTimezone\)/);
});
