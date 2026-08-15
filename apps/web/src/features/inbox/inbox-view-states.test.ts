import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./inbox-view.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../workspace/use-workspace-operations.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../shell/calmboard-app.tsx", import.meta.url), "utf8");

test("inbox provides localized all and unread filters with complete empty states", () => {
  assert.match(view, /const \[filter, setFilter\]/);
  assert.match(view, /<SegmentedTabs/);
  assert.match(view, /fmtNumber\(ctx\.notifications\.length, ctx\.locale\)/);
  assert.match(view, /لا توجد إشعارات غير مقروءة/);
  assert.match(view, /صندوق الوارد فارغ/);
});

test("mark-all is serialized and notification failures cannot become unhandled promises", () => {
  assert.match(view, /const \[markingAll, setMarkingAll\]/);
  assert.match(view, /await ctx\.markAllNotificationsRead\(\)/);
  assert.match(view, /aria-busy=\{markingAll\}/);
  assert.match(operations, /تعذر تعليم الإشعارات كمقروءة/);
  assert.match(shell, /markAllNotificationsRead: markAllRead/);
  assert.match(shell, /markAsRead\(notification\.id\)\.catch\(\(\) => undefined\)/);
});

test("notification feed exposes position and uses semantic theme surfaces", () => {
  assert.match(view, /role="feed"/);
  assert.match(view, /role="article"/);
  assert.match(view, /aria-posinset=\{index \+ 1\}/);
  assert.match(view, /aria-setsize=\{visibleNotifications\.length\}/);
  assert.match(view, /border-accent\/30 bg-accent\/5/);
  assert.doesNotMatch(view, /border-indigo-|bg-indigo-|text-slate-|dark:bg-zinc-/);
});
