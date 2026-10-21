import assert from "node:assert/strict";
import { it } from "node:test";
import {
  activityActionLabel,
  automationLabel,
  goalStatusLabel,
  invoiceStatusLabel,
  priorityLabel,
  projectStatusLabel,
  roleLabel,
  taskStatusLabel,
} from "./display-labels";

const ar = (arabic: string) => arabic;

it("provides Arabic labels for enum values displayed by the interface", () => {
  assert.equal(taskStatusLabel("in_progress", ar), "قيد التنفيذ");
  assert.equal(priorityLabel("urgent", ar), "عاجل");
  assert.equal(projectStatusLabel("on_hold", ar), "متوقف مؤقتاً");
  assert.equal(goalStatusLabel("at_risk", ar), "معرّض للخطر");
  assert.equal(invoiceStatusLabel("uncollectible", ar), "متعذرة التحصيل");
  assert.equal(roleLabel("manager", ar), "مدير");
  assert.equal(activityActionLabel("task.created", ar), "أنشأ مهمة");
  assert.equal(automationLabel("task_status_changed", ar), "تغيّر حالة مهمة");
});

it("labels backend activity actions instead of leaking raw codes", () => {
  assert.equal(activityActionLabel("attachment.upload.requested", ar), "بدأ رفع مرفق");
  assert.equal(activityActionLabel("sprint.started", ar), "بدأ سبرنت");
  assert.equal(activityActionLabel("invitation_created", ar), "أنشأ دعوة");
  assert.equal(
    activityActionLabel("task.approval.decided", (_ar, en) => en),
    "Decided on an approval request",
  );
  assert.equal(activityActionLabel("some.unknown_action", ar), "some unknown action");
});

it("labels automation triggers, conditions and actions", () => {
  assert.equal(automationLabel("schedule_daily", ar), "يومياً");
  assert.equal(automationLabel("assignTo", ar), "تعيين إلى");
  assert.equal(automationLabel("addComment", ar), "إضافة تعليق");
  assert.equal(automationLabel("done", ar), "مكتمل");
});
