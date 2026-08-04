ALTER TABLE "automation_events" ADD COLUMN "current" jsonb;
--> statement-breakpoint
UPDATE "automation_events" event
SET "current" = jsonb_build_object(
  'status', task."status",
  'priority', task."priority",
  'projectId', task."project_id",
  'assigneeId', task."assignee_id",
  'tags', task."tags",
  'version', event."task_version"
)
FROM "tasks" task
WHERE task."id" = event."task_id";
--> statement-breakpoint
ALTER TABLE "automation_events" ALTER COLUMN "current" SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "validate_automation_event_snapshot"() RETURNS trigger AS $$
BEGIN
  IF jsonb_typeof(NEW."current") <> 'object'
    OR NOT (NEW."current" ?& ARRAY['status', 'priority', 'projectId', 'assigneeId', 'tags', 'version'])
    OR jsonb_typeof(NEW."current"->'tags') <> 'array'
    OR (NEW."current"->>'version')::integer <> NEW."task_version" THEN
    RAISE EXCEPTION 'Automation event current task snapshot is invalid';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."current" IS DISTINCT FROM OLD."current" THEN
    RAISE EXCEPTION 'Automation event current task snapshot is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "automation_events_validate_snapshot"
BEFORE INSERT OR UPDATE ON "automation_events"
FOR EACH ROW EXECUTE FUNCTION "validate_automation_event_snapshot"();
