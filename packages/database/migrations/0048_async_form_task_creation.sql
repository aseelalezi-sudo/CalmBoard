ALTER TABLE "form_responses" ADD COLUMN "task_creation_payload" jsonb;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_status" varchar(20) DEFAULT 'not_requested' NOT NULL;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_max_attempts" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_available_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_last_error" text;
--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "task_creation_completed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "form_responses_task_creation_due_idx" ON "form_responses" USING btree ("task_creation_status", "task_creation_available_at", "task_creation_claimed_at");
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_task_creation_status_check" CHECK ("task_creation_status" in ('not_requested', 'pending', 'processing', 'completed', 'dead'));
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_task_creation_attempts_check" CHECK ("task_creation_attempts" >= 0 and "task_creation_max_attempts" > 0);
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_task_creation_request_check" CHECK (("task_creation_status" = 'not_requested' and "task_creation_payload" is null) or ("task_creation_status" <> 'not_requested' and "task_creation_payload" is not null));
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_task_creation_claim_check" CHECK (("task_creation_status" = 'processing' and "task_creation_claimed_at" is not null and "task_creation_claim_token" is not null) or ("task_creation_status" <> 'processing' and "task_creation_claimed_at" is null and "task_creation_claim_token" is null));
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_task_creation_result_check" CHECK (("task_creation_status" = 'completed' and "created_task_id" is not null and "task_creation_completed_at" is not null) or ("task_creation_status" <> 'completed' and "created_task_id" is null and "task_creation_completed_at" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_dead_letters(requested_limit integer DEFAULT 100)
RETURNS TABLE (
  source text,
  source_id uuid,
  organization_id uuid,
  workspace_id uuid,
  queue text,
  job_name text,
  attempts integer,
  max_attempts integer,
  error text,
  failed_at timestamptz
) AS $$
BEGIN
  IF NOT public.app_platform_admin_context() THEN
    RAISE EXCEPTION 'Platform administrator access is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT entry.source, entry.source_id, entry.organization_id, entry.workspace_id,
    entry.queue, entry.job_name, entry.attempts, entry.max_attempts, entry.error, entry.failed_at
  FROM (
    SELECT 'notification_email'::text AS source, outbox.id AS source_id,
      outbox.organization_id, outbox.workspace_id,
      'notification-email'::text AS queue, 'DeliverNotificationEmail'::text AS job_name,
      outbox.attempts, outbox.max_attempts, outbox.last_error AS error, outbox.updated_at AS failed_at
    FROM public.notification_email_outbox outbox
    WHERE outbox.status = 'dead'
    UNION ALL
    SELECT 'auth_email', outbox.id, NULL::uuid, NULL::uuid,
      'authentication-email', 'DeliverAuthenticationEmail',
      outbox.attempts, outbox.max_attempts, outbox.last_error, outbox.updated_at
    FROM public.auth_email_outbox outbox
    WHERE outbox.status = 'dead'
    UNION ALL
    SELECT 'automation_event', event.id, event.organization_id, event.workspace_id,
      'automation-events', 'ProcessAutomationEvent',
      event.attempts, event.max_attempts, event.last_error, event.updated_at
    FROM public.automation_events event
    WHERE event.status = 'dead'
    UNION ALL
    SELECT 'workspace_export', job.id, job.organization_id, job.workspace_id,
      'workspace-exports', 'BuildWorkspaceExport',
      job.attempts, job.max_attempts, job.last_error, job.updated_at
    FROM public.export_jobs job
    WHERE job.status = 'dead'
    UNION ALL
    SELECT 'form_task_creation', response.id, response.organization_id, response.workspace_id,
      'form-submissions', 'CreateTaskFromFormResponse',
      response.task_creation_attempts, response.task_creation_max_attempts,
      response.task_creation_last_error, response.task_creation_available_at
    FROM public.form_responses response
    WHERE response.task_creation_status = 'dead'
  ) entry
  ORDER BY entry.failed_at DESC, entry.source, entry.source_id
  LIMIT LEAST(GREATEST(COALESCE(requested_limit, 100), 1), 500);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retry_dead_letter(requested_source text, requested_id uuid)
RETURNS boolean AS $$
DECLARE
  changed integer := 0;
BEGIN
  IF NOT public.app_platform_admin_context() THEN
    RAISE EXCEPTION 'Platform administrator access is required' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.dead_letter_retry', 'on', true);

  CASE requested_source
    WHEN 'notification_email' THEN
      UPDATE public.notification_email_outbox
      SET status = 'pending', max_attempts = max_attempts + 5, available_at = now(),
        claimed_at = NULL, claim_token = NULL, last_error = NULL, updated_at = now()
      WHERE id = requested_id AND status = 'dead';
    WHEN 'auth_email' THEN
      UPDATE public.auth_email_outbox
      SET status = 'pending', max_attempts = max_attempts + 5, available_at = now(),
        claimed_at = NULL, claim_token = NULL, last_error = NULL, updated_at = now()
      WHERE id = requested_id AND status = 'dead';
    WHEN 'automation_event' THEN
      UPDATE public.automation_events
      SET status = 'pending', max_attempts = max_attempts + 5, available_at = now(),
        claimed_at = NULL, claim_token = NULL, last_error = NULL, updated_at = now()
      WHERE id = requested_id AND status = 'dead';
    WHEN 'workspace_export' THEN
      UPDATE public.export_jobs
      SET status = 'pending', max_attempts = max_attempts + 5, available_at = now(),
        claimed_at = NULL, claim_token = NULL, last_error = NULL, updated_at = now()
      WHERE id = requested_id AND status = 'dead';
    WHEN 'form_task_creation' THEN
      UPDATE public.form_responses
      SET task_creation_status = 'pending',
        task_creation_max_attempts = task_creation_max_attempts + 5,
        task_creation_available_at = now(), task_creation_claimed_at = NULL,
        task_creation_claim_token = NULL, task_creation_last_error = NULL
      WHERE id = requested_id AND task_creation_status = 'dead';
    ELSE
      RAISE EXCEPTION 'Unsupported dead-letter source';
  END CASE;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
