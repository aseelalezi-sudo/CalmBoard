ALTER TABLE "automation_runs" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_event_id_automation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."automation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_event_rule_unique" ON "automation_runs" USING btree ("event_id","automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_tenant_event_idx" ON "automation_runs" USING btree ("organization_id","workspace_id","event_id");--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_attempt_check" CHECK ("automation_runs"."attempt" > 0);
--> statement-breakpoint
CREATE FUNCTION "validate_automation_run_event"() RETURNS trigger AS $$
DECLARE
  linked_event record;
BEGIN
  IF NEW."event_id" IS NOT NULL THEN
    SELECT "organization_id", "workspace_id", "task_id"
    INTO linked_event
    FROM "automation_events"
    WHERE "id" = NEW."event_id";

    IF linked_event."organization_id" IS NULL
      OR linked_event."organization_id" <> NEW."organization_id"
      OR linked_event."workspace_id" <> NEW."workspace_id"
      OR linked_event."task_id" IS DISTINCT FROM NEW."task_id" THEN
      RAISE EXCEPTION 'Automation run does not match its event scope';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."organization_id" <> OLD."organization_id"
    OR NEW."workspace_id" <> OLD."workspace_id"
    OR NEW."automation_id" <> OLD."automation_id"
    OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
    OR NEW."task_id" IS DISTINCT FROM OLD."task_id"
    OR NEW."created_at" <> OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Automation run identity is immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempt" < OLD."attempt" THEN
    RAISE EXCEPTION 'Automation run attempt cannot decrease';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "automation_runs_validate_event"
BEFORE INSERT OR UPDATE ON "automation_runs"
FOR EACH ROW EXECUTE FUNCTION "validate_automation_run_event"();
