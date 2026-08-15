import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./advanced-task-gantt.tsx", import.meta.url), "utf8");

describe("Gantt layout contract", () => {
  it("keeps the dense timeline contained and keyboard accessible", () => {
    assert.match(source, /max-h-\[min\(680px,70dvh\)\] overflow-auto overscroll-contain/);
    assert.match(source, /role="region"/);
    assert.match(source, /tabIndex=\{0\}/);
  });

  it("provides timeline navigation controls", () => {
    assert.match(source, /const scrollToToday = \(\) =>/);
    assert.match(source, /const fitTimeline = \(\) =>/);
    assert.match(source, /"Today"/);
    assert.match(source, /"Fit"/);
  });

  it("distinguishes calendar context, task state, and schedule conflicts", () => {
    assert.match(source, /function isWeekend/);
    assert.match(source, /function taskBarTone/);
    assert.match(source, /conflictingTaskIds/);
    assert.match(source, /outline-2 outline-offset-2 outline-rose-500/);
  });

  it("mirrors the complete timeline for Arabic instead of only aligning its text", () => {
    assert.match(source, /const isRtl = ctx\.locale === "ar"/);
    assert.match(source, /isRtl \? "sticky right-0" : "sticky left-0"/);
    assert.match(source, /isRtl && "flex-row-reverse"/);
    assert.match(source, /scale\(-1 1\)/);
    assert.match(source, /right: visibleBaselineStart \* dayWidth/);
    assert.match(source, /marginLeft: isRtl \? "auto" : undefined/);
  });

  it("keeps the baseline selector compact and the toolbar grouped", () => {
    assert.doesNotMatch(source, /selectCls/);
    assert.match(source, /className="h-8 w-40 cursor-pointer/);
    assert.match(source, /sm:mr-auto/);
  });

  it("fills short timelines without leaving an empty side gutter", () => {
    assert.match(source, /new ResizeObserver\(updateWidth\)/);
    assert.match(source, /availableTimelineWidth \/ model\.totalDays/);
    assert.match(source, /Math\.max\(720, availableTimelineWidth/);
  });

  it("keeps the Arabic baseline action fully translated", () => {
    assert.doesNotMatch(source, /حفظ Baseline/);
    assert.match(source, /حفظ خط أساس/);
  });
});
