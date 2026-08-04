CREATE TABLE "automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"trigger" varchar(100) NOT NULL,
	"task_version" integer NOT NULL,
	"actor_id" uuid,
	"previous" jsonb,
	"depth" integer DEFAULT 0 NOT NULL,
	"parent_event_id" uuid,
	"deduplication_key" varchar(256) NOT NULL,
	"status" "notification_email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_events_trigger_check" CHECK ("automation_events"."trigger" in ('task_created', 'task_status_changed', 'task_assignee_changed', 'task_priority_changed', 'comment_added', 'schedule_daily')),
	CONSTRAINT "automation_events_depth_check" CHECK ("automation_events"."depth" between 0 and 5),
	CONSTRAINT "automation_events_attempts_check" CHECK ("automation_events"."attempts" >= 0 and "automation_events"."max_attempts" > 0),
	CONSTRAINT "automation_events_terminal_state_check" CHECK (("automation_events"."status" in ('sent', 'skipped') and "automation_events"."completed_at" is not null) or ("automation_events"."status" not in ('sent', 'skipped') and "automation_events"."completed_at" is null)),
	CONSTRAINT "automation_events_claim_state_check" CHECK (("automation_events"."status" = 'processing' and "automation_events"."claimed_at" is not null and "automation_events"."claim_token" is not null) or ("automation_events"."status" <> 'processing' and "automation_events"."claimed_at" is null and "automation_events"."claim_token" is null))
);
--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_parent_event_id_automation_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."automation_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_events_deduplication_unique" ON "automation_events" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "automation_events_tenant_status_idx" ON "automation_events" USING btree ("organization_id","workspace_id","status","available_at");--> statement-breakpoint
CREATE INDEX "automation_events_due_idx" ON "automation_events" USING btree ("status","available_at","claimed_at");
--> statement-breakpoint
CREATE FUNCTION "validate_automation_event"() RETURNS trigger AS $$
DECLARE
  linked_task record;
  parent_event record;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."organization_id" <> OLD."organization_id"
    OR NEW."workspace_id" <> OLD."workspace_id"
    OR NEW."task_id" <> OLD."task_id"
    OR NEW."trigger" <> OLD."trigger"
    OR NEW."task_version" <> OLD."task_version"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."previous" IS DISTINCT FROM OLD."previous"
    OR NEW."depth" <> OLD."depth"
    OR NEW."parent_event_id" IS DISTINCT FROM OLD."parent_event_id"
    OR NEW."deduplication_key" <> OLD."deduplication_key"
    OR NEW."max_attempts" <> OLD."max_attempts"
  ) THEN
    RAISE EXCEPTION 'Automation event identity and payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Automation event attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Terminal automation event cannot be reopened';
  END IF;

  SELECT "organization_id", "workspace_id", "version"
  INTO linked_task
  FROM "tasks"
  WHERE "id" = NEW."task_id";

  IF linked_task."organization_id" IS NULL
    OR linked_task."organization_id" <> NEW."organization_id"
    OR linked_task."workspace_id" <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'Automation event does not match its task tenant scope';
  END IF;

  IF TG_OP = 'INSERT' AND linked_task."version" < NEW."task_version" THEN
    RAISE EXCEPTION 'Automation event task version is ahead of the linked task';
  END IF;

  IF NEW."parent_event_id" IS NULL AND NEW."depth" <> 0 THEN
    RAISE EXCEPTION 'Root automation event must have zero depth';
  END IF;

  IF NEW."parent_event_id" IS NOT NULL THEN
    SELECT "organization_id", "workspace_id", "depth"
    INTO parent_event
    FROM "automation_events"
    WHERE "id" = NEW."parent_event_id";

    IF parent_event."organization_id" IS NULL
      OR parent_event."organization_id" <> NEW."organization_id"
      OR parent_event."workspace_id" <> NEW."workspace_id"
      OR NEW."depth" <> parent_event."depth" + 1 THEN
      RAISE EXCEPTION 'Automation event parent or loop depth is invalid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "automation_events_validate"
BEFORE INSERT OR UPDATE ON "automation_events"
FOR EACH ROW EXECUTE FUNCTION "validate_automation_event"();
--> statement-breakpoint
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.automation_events
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
