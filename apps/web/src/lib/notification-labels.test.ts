import assert from "node:assert/strict";
import { it } from "node:test";
import type { Notification } from "./types";
import { notificationBody, notificationTitle } from "./notification-labels";

const ar = (arabic: string) => arabic;

function notification(title: string, body?: string): Notification {
  return {
    id: "notification-1",
    title,
    body,
    type: "automation",
    isRead: false,
    createdAt: new Date(0).toISOString(),
  };
}

it("localizes legacy and generated user notifications", () => {
  assert.equal(notificationTitle(notification("تمت الإشارة إليك | You were mentioned"), ar), "تمت الإشارة إليك");
  assert.equal(notificationBody(notification("مهمة", "Launch Plan"), ar), "خطة الإطلاق");
  assert.equal(
    notificationBody(notification("مهمة", "Automation rule executed for task TASK-1049"), ar),
    "نُفذت قاعدة الأتمتة للمهمة TASK-1049",
  );
});
