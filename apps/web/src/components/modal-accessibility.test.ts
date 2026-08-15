import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ui = readFileSync(new URL("./ui.tsx", import.meta.url), "utf8");
const goals = readFileSync(new URL("../features/goals/goals-view.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../features/docs/docs-view.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("./profile-security.tsx", import.meta.url), "utf8");
const formBuilder = readFileSync(new URL("../features/forms/form-builder.tsx", import.meta.url), "utf8");

describe("shared modal contract", () => {
  it("locks page scroll, supports Escape, traps focus, and restores focus", () => {
    assert.match(ui, /document\.body\.style\.overflow = "hidden"/);
    assert.match(ui, /event\.key === "Escape"/);
    assert.match(ui, /event\.key !== "Tab"/);
    assert.match(ui, /previousFocus\?\.focus/);
  });

  it("labels the dialog and provides a mobile-sized close target", () => {
    assert.match(ui, /aria-labelledby=\{titleId\}/);
    assert.match(ui, /tabIndex=\{-1\}/);
    assert.match(ui, /h-10 w-10/);
  });

  it("uses the shared modal for goal check-ins", () => {
    assert.match(goals, /<Modal/);
    assert.doesNotMatch(goals, /fixed inset-0 z-\[70\]/);
  });

  it("uses the shared modal for document versions and access", () => {
    assert.match(docs, /title=\{ctx\.t\("تاريخ إصدارات المستند"/);
    assert.match(docs, /title=\{ctx\.t\("صلاحيات المستند"/);
    assert.doesNotMatch(docs, /fixed inset-0 z-\[(70|75)\]/);
  });

  it("uses the shared modal for two-factor setup", () => {
    assert.match(profile, /title=\{ctx\.t\("إعداد تطبيق المصادقة"/);
    assert.match(profile, /autoComplete="one-time-code"/);
    assert.doesNotMatch(profile, /fixed inset-0 z-70/);
  });

  it("uses the workspace modal contract for the form builder", () => {
    assert.match(formBuilder, /size="workspace"/);
    assert.match(formBuilder, /contentScrollable=\{false\}/);
    assert.match(formBuilder, /role="alert"/);
    assert.doesNotMatch(formBuilder, /fixed inset-0 z-\[70\]/);
  });
});
