CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"locked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_period_check" CHECK ("timesheets"."period_end" >= "timesheets"."period_start"),
	CONSTRAINT "timesheets_period_length_check" CHECK ("timesheets"."period_end" - "timesheets"."period_start" between 0 and 30),
	CONSTRAINT "timesheets_status_check" CHECK ("timesheets"."status" in ('draft', 'submitted', 'approved', 'rejected')),
	CONSTRAINT "timesheets_version_check" CHECK ("timesheets"."version" >= 1),
	CONSTRAINT "timesheets_submission_state_check" CHECK ("timesheets"."status" = 'draft' or "timesheets"."submitted_at" is not null),
	CONSTRAINT "timesheets_review_state_check" CHECK ("timesheets"."status" not in ('approved', 'rejected') or ("timesheets"."reviewed_by_id" is not null and "timesheets"."reviewed_at" is not null)),
	CONSTRAINT "timesheets_lock_state_check" CHECK ("timesheets"."status" = 'approved' or "timesheets"."locked_at" is null),
	CONSTRAINT "timesheets_approved_lock_check" CHECK ("timesheets"."status" <> 'approved' or "timesheets"."locked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "timesheet_id" uuid;
--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "time_logs"
SET
	"ended_at" = COALESCE("ended_at", "started_at" + ("duration_minutes" * interval '1 minute')),
	"billable" = COALESCE("billable", true);
--> statement-breakpoint
INSERT INTO "timesheets" ("organization_id", "workspace_id", "user_id", "period_start", "period_end")
SELECT DISTINCT
	"organization_id",
	"workspace_id",
	"user_id",
	date_trunc('week', "started_at" AT TIME ZONE 'UTC')::date,
	(date_trunc('week', "started_at" AT TIME ZONE 'UTC')::date + 6)
FROM "time_logs"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "time_logs" log
SET "timesheet_id" = period."id"
FROM "timesheets" period
WHERE period."organization_id" = log."organization_id"
	AND period."workspace_id" = log."workspace_id"
	AND period."user_id" = log."user_id"
	AND (log."started_at" AT TIME ZONE 'UTC')::date BETWEEN period."period_start" AND period."period_end";
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "time_logs" WHERE "timesheet_id" IS NULL) THEN
		RAISE EXCEPTION 'Every existing time log must map to a timesheet period';
	END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "time_logs" ALTER COLUMN "ended_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_logs" ALTER COLUMN "billable" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_logs" ALTER COLUMN "timesheet_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "timesheets_tenant_user_period_unique" ON "timesheets" USING btree ("organization_id","workspace_id","user_id","period_start","period_end");
--> statement-breakpoint
CREATE INDEX "timesheets_tenant_review_queue_idx" ON "timesheets" USING btree ("organization_id","workspace_id","status","period_start");
--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "time_logs_tenant_user_started_idx" ON "time_logs" USING btree ("organization_id","workspace_id","user_id","started_at");
--> statement-breakpoint
CREATE INDEX "time_logs_timesheet_active_idx" ON "time_logs" USING btree ("timesheet_id","deleted_at","started_at");
--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_duration_check" CHECK ("time_logs"."duration_minutes" > 0 and "time_logs"."duration_minutes" <= 1440);
--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_range_check" CHECK ("time_logs"."ended_at" >= "time_logs"."started_at");
--> statement-breakpoint
INSERT INTO "permissions" ("key", "name", "description", "category")
VALUES ('timesheets.review', 'Review timesheets', 'Approve or reject submitted workspace timesheets', 'tasks')
ON CONFLICT ("key") DO UPDATE SET
	"name" = excluded."name",
	"description" = excluded."description",
	"category" = excluded."category";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'timesheets.review'
WHERE role."is_system" = true
	AND role."key" IN ('owner', 'admin', 'manager')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.timesheets
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_timesheet_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public.workspaces workspace
		WHERE workspace.id = NEW.workspace_id
			AND workspace.organization_id = NEW.organization_id
			AND workspace.deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'Timesheet workspace is outside the organization';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.memberships membership
		WHERE membership.organization_id = NEW.organization_id
			AND membership.user_id = NEW.user_id
			AND membership.status = 'active'
			AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
	) THEN
		RAISE EXCEPTION 'Timesheet owner must be an active workspace member';
	END IF;
	IF NEW.reviewed_by_id IS NOT NULL THEN
		IF NEW.reviewed_by_id = NEW.user_id THEN
			RAISE EXCEPTION 'A reviewer cannot approve their own timesheet';
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM public.memberships membership
			WHERE membership.organization_id = NEW.organization_id
				AND membership.user_id = NEW.reviewed_by_id
				AND membership.status = 'active'
				AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
		) THEN
			RAISE EXCEPTION 'Timesheet reviewer must be an active workspace member';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER timesheets_validate_scope
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, user_id, reviewed_by_id
ON public.timesheets
FOR EACH ROW EXECUTE FUNCTION public.validate_timesheet_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_timesheet_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF OLD.organization_id <> NEW.organization_id
		OR OLD.workspace_id <> NEW.workspace_id
		OR OLD.user_id <> NEW.user_id
		OR OLD.period_start <> NEW.period_start
		OR OLD.period_end <> NEW.period_end THEN
		RAISE EXCEPTION 'Timesheet identity and period are immutable';
	END IF;
	IF OLD.status = 'approved' THEN
		RAISE EXCEPTION 'Approved timesheets are immutable';
	END IF;
	IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'submitted') THEN
		RAISE EXCEPTION 'Invalid timesheet status transition';
	END IF;
	IF OLD.status = 'submitted' AND NEW.status NOT IN ('submitted', 'approved', 'rejected') THEN
		RAISE EXCEPTION 'Invalid timesheet status transition';
	END IF;
	IF OLD.status = 'rejected' AND NEW.status NOT IN ('rejected', 'draft', 'submitted') THEN
		RAISE EXCEPTION 'Invalid timesheet status transition';
	END IF;
	IF NEW.status = 'submitted' AND OLD.status <> 'submitted' AND NOT EXISTS (
		SELECT 1 FROM public.time_logs log
		WHERE log.timesheet_id = NEW.id AND log.deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'An empty timesheet cannot be submitted';
	END IF;
	IF NEW.version < OLD.version THEN
		RAISE EXCEPTION 'Timesheet version cannot decrease';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER timesheets_guard_transition
BEFORE UPDATE ON public.timesheets
FOR EACH ROW EXECUTE FUNCTION public.guard_timesheet_transition();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_time_log_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	period public.timesheets%ROWTYPE;
	target_id uuid;
BEGIN
	target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.timesheet_id ELSE NEW.timesheet_id END;
	SELECT * INTO period FROM public.timesheets WHERE id = target_id;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Timesheet period does not exist';
	END IF;
	IF period.status IN ('submitted', 'approved') OR period.locked_at IS NOT NULL THEN
		RAISE EXCEPTION 'The timesheet period is locked for editing';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NEW.organization_id <> period.organization_id
		OR NEW.workspace_id <> period.workspace_id
		OR NEW.user_id <> period.user_id THEN
		RAISE EXCEPTION 'Time log scope must match its timesheet';
	END IF;
	IF (NEW.started_at AT TIME ZONE 'UTC')::date NOT BETWEEN period.period_start AND period.period_end THEN
		RAISE EXCEPTION 'Time log date must be inside its timesheet period';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.tasks task
		WHERE task.id = NEW.task_id
			AND task.organization_id = NEW.organization_id
			AND task.workspace_id = NEW.workspace_id
			AND task.deleted_at IS NULL
	) THEN
		RAISE EXCEPTION 'Time log task is outside the timesheet tenant';
	END IF;
	IF TG_OP = 'UPDATE' AND (
		OLD.organization_id <> NEW.organization_id
		OR OLD.workspace_id <> NEW.workspace_id
		OR OLD.user_id <> NEW.user_id
		OR OLD.timesheet_id <> NEW.timesheet_id
	) THEN
		RAISE EXCEPTION 'Time log tenant identity is immutable';
	END IF;
	NEW.updated_at := CURRENT_TIMESTAMP;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER time_logs_guard_period
BEFORE INSERT OR UPDATE OR DELETE ON public.time_logs
FOR EACH ROW EXECUTE FUNCTION public.guard_time_log_period();
