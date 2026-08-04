CREATE TYPE "public"."notification_email_status" AS ENUM('pending', 'processing', 'sent', 'skipped', 'dead');--> statement-breakpoint
CREATE TABLE "notification_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid,
	"subject" varchar(500) NOT NULL,
	"body" text,
	"idempotency_key" varchar(256) NOT NULL,
	"status" "notification_email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_email_outbox_attempts_check" CHECK ("notification_email_outbox"."attempts" >= 0 and "notification_email_outbox"."max_attempts" > 0),
	CONSTRAINT "notification_email_outbox_terminal_state_check" CHECK (("notification_email_outbox"."status" = 'sent' and "notification_email_outbox"."sent_at" is not null) or ("notification_email_outbox"."status" <> 'sent' and "notification_email_outbox"."sent_at" is null))
);
--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_email_outbox_idempotency_unique" ON "notification_email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_email_outbox_tenant_status_idx" ON "notification_email_outbox" USING btree ("organization_id","workspace_id","status","available_at");--> statement-breakpoint
CREATE INDEX "notification_email_outbox_due_idx" ON "notification_email_outbox" USING btree ("status","available_at","claimed_at");
--> statement-breakpoint
CREATE FUNCTION "validate_notification_email_outbox_scope"() RETURNS trigger AS $$
DECLARE
  workspace_organization_id uuid;
  linked_notification record;
BEGIN
  SELECT "organization_id"
  INTO workspace_organization_id
  FROM "workspaces"
  WHERE "id" = NEW."workspace_id";

  IF workspace_organization_id IS NULL OR workspace_organization_id <> NEW."organization_id" THEN
    RAISE EXCEPTION 'Notification email workspace does not belong to its organization';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."organization_id" <> OLD."organization_id"
    OR NEW."workspace_id" <> OLD."workspace_id"
    OR NEW."user_id" <> OLD."user_id"
    OR NEW."notification_id" IS DISTINCT FROM OLD."notification_id"
    OR NEW."subject" <> OLD."subject"
    OR NEW."body" IS DISTINCT FROM OLD."body"
    OR NEW."idempotency_key" <> OLD."idempotency_key"
    OR NEW."max_attempts" <> OLD."max_attempts"
  ) THEN
    RAISE EXCEPTION 'Notification email delivery identity and payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Notification email attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Terminal notification email delivery cannot be reopened';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM "memberships" membership
    WHERE membership."user_id" = NEW."user_id"
      AND membership."organization_id" = NEW."organization_id"
      AND (membership."workspace_id" = NEW."workspace_id" OR membership."workspace_id" IS NULL)
      AND membership."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Notification email recipient is not an active tenant member';
  END IF;

  IF NEW."notification_id" IS NOT NULL THEN
    SELECT "organization_id", "workspace_id", "user_id"
    INTO linked_notification
    FROM "notifications"
    WHERE "id" = NEW."notification_id";

    IF linked_notification."organization_id" IS NULL
      OR linked_notification."organization_id" <> NEW."organization_id"
      OR linked_notification."workspace_id" <> NEW."workspace_id"
      OR linked_notification."user_id" <> NEW."user_id" THEN
      RAISE EXCEPTION 'Notification email does not match its linked notification scope';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "notification_email_outbox_validate_scope"
BEFORE INSERT OR UPDATE ON "notification_email_outbox"
FOR EACH ROW EXECUTE FUNCTION "validate_notification_email_outbox_scope"();
--> statement-breakpoint
ALTER TABLE public.notification_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_email_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.notification_email_outbox
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
