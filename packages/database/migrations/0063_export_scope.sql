CREATE TYPE "public"."export_scope" AS ENUM('workspace', 'organization');--> statement-breakpoint
ALTER TABLE "export_jobs" DROP CONSTRAINT "export_jobs_schedule_fields_check";--> statement-breakpoint
ALTER TABLE "export_jobs" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "export_scope" "export_scope" DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
CREATE INDEX "export_jobs_expired_cleanup_idx" ON "export_jobs" USING btree ("expires_at","id") WHERE "export_jobs"."status" = 'completed' and "export_jobs"."expires_at" is not null;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_scope_target_check" CHECK (("export_jobs"."export_scope" = 'workspace' and "export_jobs"."workspace_id" is not null) or ("export_jobs"."export_scope" = 'organization' and "export_jobs"."workspace_id" is null));--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_format_check" CHECK ("export_jobs"."export_scope" <> 'organization' or "export_jobs"."format" = 'json');--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_schedule_fields_check" CHECK (("export_jobs"."report_schedule_id" is null and "export_jobs"."scheduled_for" is null) or ("export_jobs"."report_schedule_id" is not null and "export_jobs"."scheduled_for" is not null and "export_jobs"."export_scope" = 'workspace' and "export_jobs"."workspace_id" is not null and "export_jobs"."format" in ('pdf', 'xlsx')));
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
  IF NEW.export_scope = 'workspace' THEN
    SELECT organization_id INTO workspace_organization_id
    FROM public.workspaces
    WHERE id = NEW.workspace_id;
    IF workspace_organization_id IS NULL OR workspace_organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Export workspace does not belong to its organization';
    END IF;
    IF TG_OP = 'INSERT' AND NOT EXISTS (
      SELECT 1
      FROM public.memberships membership
      WHERE membership.user_id = NEW.requested_by
        AND membership.organization_id = NEW.organization_id
        AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Export requester is not an active Workspace member';
    END IF;
  ELSIF NEW.export_scope = 'organization' THEN
    IF TG_OP = 'INSERT' AND NOT EXISTS (
      SELECT 1
      FROM public.memberships membership
      WHERE membership.user_id = NEW.requested_by
        AND membership.organization_id = NEW.organization_id
        AND membership.workspace_id IS NULL
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Export requester is not an active Organization member';
    END IF;
  ELSE
    RAISE EXCEPTION 'Export scope is invalid';
  END IF;

  IF NEW.report_schedule_id IS NOT NULL THEN
    IF NEW.export_scope <> 'workspace' OR NEW.workspace_id IS NULL THEN
      RAISE EXCEPTION 'Scheduled exports must remain Workspace scoped';
    END IF;
    SELECT organization_id, workspace_id, created_by, format
    INTO linked_schedule
    FROM public.report_schedules WHERE id = NEW.report_schedule_id;
    IF linked_schedule.organization_id IS NULL
      OR linked_schedule.organization_id <> NEW.organization_id
      OR linked_schedule.workspace_id IS DISTINCT FROM NEW.workspace_id
      OR linked_schedule.created_by <> NEW.requested_by
      OR linked_schedule.format <> NEW.format THEN
      RAISE EXCEPTION 'Scheduled export does not match its report schedule';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.export_scope IS DISTINCT FROM OLD.export_scope
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.format IS DISTINCT FROM OLD.format
    OR NEW.report_schedule_id IS DISTINCT FROM OLD.report_schedule_id
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR (NEW.max_attempts IS DISTINCT FROM OLD.max_attempts AND NOT retry_allowed)
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
DROP POLICY tenant_isolation ON public.export_jobs;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.export_jobs
USING (
  requested_by = public.app_current_actor_id()
  AND public.app_tenant_matches(organization_id, workspace_id)
)
WITH CHECK (
  requested_by = public.app_current_actor_id()
  AND public.app_tenant_matches(organization_id, workspace_id)
);
