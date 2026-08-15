import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./members-view.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../workspace/use-workspace-operations.ts", import.meta.url), "utf8");

test("member and invitation mutations are serialized and failure-safe", () => {
  assert.match(view, /const \[pendingMemberAction, setPendingMemberAction\]/);
  assert.match(view, /const \[pendingInvitationAction, setPendingInvitationAction\]/);
  assert.match(view, /await operation\(\)/);
  assert.match(view, /aria-busy=\{pendingMemberAction === `\$\{m\.id\}:role`\}/);
  assert.match(view, /aria-busy=\{pendingInvitationAction === `\$\{inv\.id\}:resend`\}/);
  assert.match(view, /aria-busy=\{pendingInvitationAction === `\$\{inv\.id\}:revoke`\}/);
});

test("skills update only after persistence and failures are localized", () => {
  const request = operations.indexOf("await updateUserSkillsRecord");
  const state = operations.indexOf("setUsers((previous)", request);
  assert.ok(request >= 0 && state > request);
  assert.match(operations, /تعذر تحديث المهارات\. حاول مجدداً/);
  assert.match(operations, /تعذر تحديث الدور\. حاول مجدداً/);
  assert.match(operations, /تعذر إعادة إرسال الدعوة\. حاول مجدداً/);
  assert.match(operations, /تعذر إلغاء الدعوة\. حاول مجدداً/);
  assert.doesNotMatch(
    operations.slice(operations.indexOf("const updateMemberRole"), operations.indexOf("const updateWorkspace")),
    /error instanceof Error \? error\.message/,
  );
});

test("member controls respect authorization and self-service boundaries", () => {
  assert.match(view, /const canInviteMembers = ctx\.can\("members\.invite"\)/);
  assert.match(view, /const canManageMembers = ctx\.can\("members\.manage"\)/);
  assert.match(view, /canManageMembers && m\.role !== "owner" \? \(/);
  assert.match(view, /m\.userId === ctx\.currentUser\?\.id && \(/);
  assert.match(view, /canInviteMembers && \(/);
  assert.match(view, /canManageMembers && \(/);
});

test("members use localized labels, semantic surfaces, and complete empty states", () => {
  assert.match(view, /<ScreenState/);
  assert.match(view, /skillLabel\(sk\)/);
  assert.match(view, /لم تُضف مهارات/);
  assert.match(view, /roleLabel\(r, ctx\.t\)/);
  assert.match(view, /fmtNumber\(pct, ctx\.locale\)/);
  assert.match(view, /divide-y divide-line/);
  assert.doesNotMatch(view, /General Work|🛠️|text-slate-|dark:text-zinc-|divide-slate-/);
});
