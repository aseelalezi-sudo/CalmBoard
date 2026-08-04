import {
  createNotificationsRepository,
  type CreateNotificationInput,
  type DatabaseTenantContext,
} from "@calmboard/database";

export type NotificationChannel = "in_app" | "email" | "push" | "all";
export type DispatchNotificationInput = CreateNotificationInput & { channels?: NotificationChannel };

export type NotificationDispatchRepository = Pick<
  ReturnType<typeof createNotificationsRepository>,
  "create" | "enqueueEmail" | "getDeliveryProfile"
>;

export async function dispatchNotification(
  context: DatabaseTenantContext,
  input: DispatchNotificationInput,
  repository: NotificationDispatchRepository = createNotificationsRepository(context),
) {
  const channels = input.channels ?? "all";
  const delivered: NotificationChannel[] = [];
  const queued: NotificationChannel[] = [];
  let notificationId: string | null = null;
  if (channels === "in_app" || channels === "all") {
    const notification = await repository.create(input);
    notificationId = notification.id;
    delivered.push("in_app");
  }
  if (channels === "email" || channels === "all") {
    const { user, preferences } = await repository.getDeliveryProfile(input.userId);
    if (user.email && preferences?.emailEnabled !== false) {
      await repository.enqueueEmail(input, notificationId);
      queued.push("email");
    }
  }
  return { ok: true, delivered, queued, requestedChannels: channels };
}
