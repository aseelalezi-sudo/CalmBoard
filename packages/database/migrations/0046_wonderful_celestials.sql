CREATE TABLE "report_schedule_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"format" varchar(20) NOT NULL,
	"cadence" varchar(20) NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"minute_of_day" integer DEFAULT 480 NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "report_schedules_format_check" CHECK ("report_schedules"."format" in ('pdf', 'xlsx')),
	CONSTRAINT "report_schedules_cadence_check" CHECK ("report_schedules"."cadence" in ('daily', 'weekly', 'monthly')),
	CONSTRAINT "report_schedules_minute_check" CHECK ("report_schedules"."minute_of_day" between 0 and 1439),
	CONSTRAINT "report_schedules_weekday_check" CHECK ("report_schedules"."day_of_week" is null or "report_schedules"."day_of_week" between 0 and 6),
	CONSTRAINT "report_schedules_monthday_check" CHECK ("report_schedules"."day_of_month" is null or "report_schedules"."day_of_month" between 1 and 28),
	CONSTRAINT "report_schedules_cadence_fields_check" CHECK (("report_schedules"."cadence" = 'daily' and "report_schedules"."day_of_week" is null and "report_schedules"."day_of_month" is null) or ("report_schedules"."cadence" = 'weekly' and "report_schedules"."day_of_week" is not null and "report_schedules"."day_of_month" is null) or ("report_schedules"."cadence" = 'monthly' and "report_schedules"."day_of_week" is null and "report_schedules"."day_of_month" is not null)),
	CONSTRAINT "report_schedules_version_check" CHECK ("report_schedules"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "report_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD COLUMN "attachment_object_key" text;--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD COLUMN "attachment_file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD COLUMN "attachment_content_type" varchar(100);--> statement-breakpoint
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedule_recipients_schedule_user_unique" ON "report_schedule_recipients" USING btree ("schedule_id","user_id");--> statement-breakpoint
CREATE INDEX "report_schedule_recipients_tenant_user_idx" ON "report_schedule_recipients" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("is_enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "report_schedules_tenant_idx" ON "report_schedules" USING btree ("organization_id","workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_report_schedule_id_report_schedules_id_fk" FOREIGN KEY ("report_schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_schedule_occurrence_unique" ON "export_jobs" USING btree ("report_schedule_id","scheduled_for") WHERE "export_jobs"."report_schedule_id" is not null and "export_jobs"."scheduled_for" is not null;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_schedule_fields_check" CHECK (("export_jobs"."report_schedule_id" is null and "export_jobs"."scheduled_for" is null) or ("export_jobs"."report_schedule_id" is not null and "export_jobs"."scheduled_for" is not null and "export_jobs"."format" in ('pdf', 'xlsx')));--> statement-breakpoint
ALTER TABLE "notification_email_outbox" ADD CONSTRAINT "notification_email_outbox_attachment_check" CHECK (("notification_email_outbox"."attachment_object_key" is null and "notification_email_outbox"."attachment_file_name" is null and "notification_email_outbox"."attachment_content_type" is null) or ("notification_email_outbox"."attachment_object_key" is not null and "notification_email_outbox"."attachment_file_name" is not null and "notification_email_outbox"."attachment_content_type" is not null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.next_report_run(
  requested_cadence text,
  requested_timezone text,
  requested_minute_of_day integer,
  requested_day_of_week integer,
  requested_day_of_month integer,
  after_time timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  local_after timestamp;
  candidate_date date;
  candidate_time timestamptz;
  offset_days integer;
BEGIN
  IF requested_cadence NOT IN ('daily', 'weekly', 'monthly')
    OR requested_minute_of_day NOT BETWEEN 0 AND 1439
    OR (requested_cadence = 'weekly' AND requested_day_of_week NOT BETWEEN 0 AND 6)
    OR (requested_cadence = 'monthly' AND requested_day_of_month NOT BETWEEN 1 AND 28) THEN
    RAISE EXCEPTION 'Invalid report recurrence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = requested_timezone) THEN
    RAISE EXCEPTION 'Invalid report timezone';
  END IF;

  local_after := after_time AT TIME ZONE requested_timezone;
  FOR offset_days IN 0..400 LOOP
    candidate_date := local_after::date + offset_days;
    IF requested_cadence = 'daily'
      OR (requested_cadence = 'weekly' AND extract(dow FROM candidate_date)::integer = requested_day_of_week)
      OR (requested_cadence = 'monthly' AND extract(day FROM candidate_date)::integer = requested_day_of_month) THEN
      candidate_time := (candidate_date + make_interval(mins => requested_minute_of_day)) AT TIME ZONE requested_timezone;
      IF candidate_time > after_time THEN
        RETURN candidate_time;
      END IF;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Could not calculate the next report occurrence';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_report_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.created_by <> OLD.created_by
    OR NEW.created_at <> OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Report schedule ownership and tenant scope are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version < OLD.version THEN
    RAISE EXCEPTION 'Report schedule version cannot decrease';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces workspace
    WHERE workspace.id = NEW.workspace_id
      AND workspace.organization_id = NEW.organization_id
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Report schedule workspace is outside the organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = NEW.created_by
      AND membership.status = 'active'
      AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Report schedule creator must be an active workspace member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Report schedule timezone is invalid';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER report_schedules_validate
BEFORE INSERT OR UPDATE ON public.report_schedules
FOR EACH ROW EXECUTE FUNCTION public.validate_report_schedule();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_report_schedule_recipient()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Report schedule recipients are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.report_schedules schedule
    WHERE schedule.id = NEW.schedule_id
      AND schedule.organization_id = NEW.organization_id
      AND schedule.workspace_id = NEW.workspace_id
      AND schedule.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Report recipient does not match its schedule scope';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = NEW.user_id
      AND membership.status = 'active'
      AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Report recipient must be an active workspace member';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER report_schedule_recipients_validate
BEFORE INSERT OR UPDATE ON public.report_schedule_recipients
FOR EACH ROW EXECUTE FUNCTION public.validate_report_schedule_recipient();
--> statement-breakpoint
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY report_schedules_owner_isolation ON public.report_schedules
USING (public.app_tenant_matches(organization_id, workspace_id) AND created_by = public.app_current_actor_id())
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id) AND created_by = public.app_current_actor_id());
ALTER TABLE public.report_schedule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedule_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY report_schedule_recipients_owner_isolation ON public.report_schedule_recipients
USING (
  public.app_tenant_matches(organization_id, workspace_id)
  AND EXISTS (
    SELECT 1 FROM public.report_schedules schedule
    WHERE schedule.id = report_schedule_recipients.schedule_id
      AND schedule.created_by = public.app_current_actor_id()
  )
)
WITH CHECK (
  public.app_tenant_matches(organization_id, workspace_id)
  AND EXISTS (
    SELECT 1 FROM public.report_schedules schedule
    WHERE schedule.id = report_schedule_recipients.schedule_id
      AND schedule.created_by = public.app_current_actor_id()
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_export_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  workspace_organization_id uuid;
  linked_schedule record;
  retry_allowed boolean := public.app_dead_letter_retry_context();
BEGIN
  SELECT organization_id INTO workspace_organization_id FROM public.workspaces WHERE id = NEW.workspace_id;
  IF workspace_organization_id IS NULL OR workspace_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Export workspace does not belong to its organization';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.user_id = NEW.requested_by
      AND membership.organization_id = NEW.organization_id
      AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Export requester is not an active tenant member';
  END IF;
  IF NEW.report_schedule_id IS NOT NULL THEN
    SELECT organization_id, workspace_id, created_by, format
    INTO linked_schedule
    FROM public.report_schedules WHERE id = NEW.report_schedule_id;
    IF linked_schedule.organization_id IS NULL
      OR linked_schedule.organization_id <> NEW.organization_id
      OR linked_schedule.workspace_id <> NEW.workspace_id
      OR linked_schedule.created_by <> NEW.requested_by
      OR linked_schedule.format <> NEW.format THEN
      RAISE EXCEPTION 'Scheduled export does not match its report schedule';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.requested_by <> OLD.requested_by
    OR NEW.format <> OLD.format
    OR NEW.report_schedule_id IS DISTINCT FROM OLD.report_schedule_id
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR (NEW.max_attempts <> OLD.max_attempts AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Export job identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Export job attempts cannot decrease';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.max_attempts < OLD.max_attempts THEN
    RAISE EXCEPTION 'Export job maximum attempts cannot decrease';
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('completed', 'dead', 'expired')
    AND NEW.status <> OLD.status
    AND NOT (retry_allowed AND OLD.status = 'dead' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'Terminal export job cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_notification_email_outbox_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  workspace_organization_id uuid;
  linked_notification record;
  retry_allowed boolean := public.app_dead_letter_retry_context();
BEGIN
  SELECT organization_id INTO workspace_organization_id FROM public.workspaces WHERE id = NEW.workspace_id;
  IF workspace_organization_id IS NULL OR workspace_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Notification email workspace does not belong to its organization';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id
    OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.user_id <> OLD.user_id
    OR NEW.notification_id IS DISTINCT FROM OLD.notification_id
    OR NEW.subject <> OLD.subject
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.attachment_object_key IS DISTINCT FROM OLD.attachment_object_key
    OR NEW.attachment_file_name IS DISTINCT FROM OLD.attachment_file_name
    OR NEW.attachment_content_type IS DISTINCT FROM OLD.attachment_content_type
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR (NEW.max_attempts <> OLD.max_attempts AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Notification email delivery identity and payload are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Notification email attempts cannot decrease';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.max_attempts < OLD.max_attempts THEN
    RAISE EXCEPTION 'Notification email maximum attempts cannot decrease';
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('sent', 'skipped', 'dead')
    AND NEW.status <> OLD.status
    AND NOT (retry_allowed AND OLD.status = 'dead' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'Terminal notification email delivery cannot be reopened';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.user_id = NEW.user_id
      AND membership.organization_id = NEW.organization_id
      AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Notification email recipient is not an active tenant member';
  END IF;
  IF NEW.notification_id IS NOT NULL THEN
    SELECT organization_id, workspace_id, user_id INTO linked_notification
    FROM public.notifications WHERE id = NEW.notification_id;
    IF linked_notification.organization_id IS NULL
      OR linked_notification.organization_id <> NEW.organization_id
      OR linked_notification.workspace_id <> NEW.workspace_id
      OR linked_notification.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Notification email does not match its linked notification scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
