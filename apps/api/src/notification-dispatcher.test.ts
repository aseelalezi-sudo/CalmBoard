import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dispatchNotification,
  type NotificationDispatchRepository,
  type DispatchNotificationInput,
} from "./notification-dispatcher.js";

const context = { organizationId: "organization-1", workspaceId: "workspace-1" };
const input: DispatchNotificationInput = {
  userId: "user-1",
  type: "daily_digest",
  title: "Daily digest",
  body: "Two tasks need attention",
  channels: "all",
};

function repository(overrides: Partial<NotificationDispatchRepository> = {}): NotificationDispatchRepository {
  return {
    create: async () => ({ id: "notification-1" }) as never,
    enqueueEmail: async () => ({ id: "outbox-1" }) as never,
    getDeliveryProfile: async () =>
      ({
        user: { email: "member@example.com" },
        preferences: { emailEnabled: true },
      }) as never,
    ...overrides,
  };
}

describe("notification dispatcher", () => {
  it("persists in-app delivery and queues email without calling the provider", async () => {
    let linkedNotificationId: string | null | undefined;
    const result = await dispatchNotification(
      context,
      input,
      repository({
        enqueueEmail: async (_input, notificationId) => {
          linkedNotificationId = notificationId;
          return { id: "outbox-1" } as never;
        },
      }),
    );

    assert.deepEqual(result, {
      ok: true,
      delivered: ["in_app"],
      queued: ["email"],
      requestedChannels: "all",
    });
    assert.equal(linkedNotificationId, "notification-1");
  });

  it("does not queue email after the recipient disables the channel", async () => {
    let queued = false;
    const result = await dispatchNotification(
      context,
      { ...input, channels: "email" },
      repository({
        getDeliveryProfile: async () =>
          ({
            user: { email: "member@example.com" },
            preferences: { emailEnabled: false },
          }) as never,
        enqueueEmail: async () => {
          queued = true;
          return { id: "outbox-1" } as never;
        },
      }),
    );
    assert.deepEqual(result.delivered, []);
    assert.deepEqual(result.queued, []);
    assert.equal(queued, false);
  });
});
