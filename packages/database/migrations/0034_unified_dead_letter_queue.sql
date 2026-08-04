CREATE OR REPLACE FUNCTION public.app_platform_admin_context()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users "user"
    WHERE "user".id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND "user".is_platform_admin = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_dead_letter_retry_context()
RETURNS boolean AS $$
  SELECT current_setting('app.dead_letter_retry', true) = 'on'
    AND public.app_platform_admin_context();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_notification_email_outbox_scope"() RETURNS trigger AS $$
DECLARE
  workspace_organization_id uuid;
  linked_notification record;
  retry_allowed boolean := public.app_dead_letter_retry_context();
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
    OR (NEW."max_attempts" <> OLD."max_attempts" AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Notification email delivery identity and payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Notification email attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."max_attempts" < OLD."max_attempts" THEN
    RAISE EXCEPTION 'Notification email maximum attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status"
    AND NOT (retry_allowed AND OLD."status" = 'dead' AND NEW."status" = 'pending') THEN
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
CREATE OR REPLACE FUNCTION "validate_auth_email_outbox"() RETURNS trigger AS $$
DECLARE
  linked_token record;
  retry_allowed boolean := public.app_dead_letter_retry_context();
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."user_id" <> OLD."user_id"
    OR NEW."auth_token_id" <> OLD."auth_token_id"
    OR NEW."purpose" <> OLD."purpose"
    OR NEW."encrypted_payload" <> OLD."encrypted_payload"
    OR NEW."initialization_vector" <> OLD."initialization_vector"
    OR NEW."authentication_tag" <> OLD."authentication_tag"
    OR NEW."encryption_algorithm" <> OLD."encryption_algorithm"
    OR NEW."encryption_key_version" <> OLD."encryption_key_version"
    OR NEW."idempotency_key" <> OLD."idempotency_key"
    OR (NEW."max_attempts" <> OLD."max_attempts" AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Authentication email delivery identity and encrypted payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Authentication email attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."max_attempts" < OLD."max_attempts" THEN
    RAISE EXCEPTION 'Authentication email maximum attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status"
    AND NOT (retry_allowed AND OLD."status" = 'dead' AND NEW."status" = 'pending') THEN
    RAISE EXCEPTION 'Terminal authentication email delivery cannot be reopened';
  END IF;

  SELECT "user_id", "purpose", "consumed_at", "invalidated_at", "expires_at"
  INTO linked_token
  FROM "auth_tokens"
  WHERE "id" = NEW."auth_token_id";

  IF linked_token."user_id" IS NULL
    OR linked_token."user_id" <> NEW."user_id"
    OR linked_token."purpose" <> NEW."purpose" THEN
    RAISE EXCEPTION 'Authentication email does not match its linked token';
  END IF;

  IF TG_OP = 'INSERT' AND (
    linked_token."consumed_at" IS NOT NULL
    OR linked_token."invalidated_at" IS NOT NULL
    OR linked_token."expires_at" <= now()
  ) THEN
    RAISE EXCEPTION 'Authentication email requires an active token';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_automation_event"() RETURNS trigger AS $$
DECLARE
  linked_task record;
  parent_event record;
  retry_allowed boolean := public.app_dead_letter_retry_context();
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
    OR (NEW."max_attempts" <> OLD."max_attempts" AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Automation event identity and payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Automation event attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."max_attempts" < OLD."max_attempts" THEN
    RAISE EXCEPTION 'Automation event maximum attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status"
    AND NOT (retry_allowed AND OLD."status" = 'dead' AND NEW."status" = 'pending') THEN
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
CREATE OR REPLACE FUNCTION "validate_export_job"() RETURNS trigger AS $$
DECLARE
  workspace_organization_id uuid;
  retry_allowed boolean := public.app_dead_letter_retry_context();
BEGIN
  SELECT "organization_id"
  INTO workspace_organization_id
  FROM "workspaces"
  WHERE "id" = NEW."workspace_id";

  IF workspace_organization_id IS NULL OR workspace_organization_id <> NEW."organization_id" THEN
    RAISE EXCEPTION 'Export workspace does not belong to its organization';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM "memberships" membership
    WHERE membership."user_id" = NEW."requested_by"
      AND membership."organization_id" = NEW."organization_id"
      AND (membership."workspace_id" = NEW."workspace_id" OR membership."workspace_id" IS NULL)
      AND membership."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Export requester is not an active tenant member';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."organization_id" <> OLD."organization_id"
    OR NEW."workspace_id" <> OLD."workspace_id"
    OR NEW."requested_by" <> OLD."requested_by"
    OR NEW."format" <> OLD."format"
    OR NEW."idempotency_key" <> OLD."idempotency_key"
    OR (NEW."max_attempts" <> OLD."max_attempts" AND NOT retry_allowed)
  ) THEN
    RAISE EXCEPTION 'Export job identity is immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Export job attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."max_attempts" < OLD."max_attempts" THEN
    RAISE EXCEPTION 'Export job maximum attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('completed', 'dead', 'expired')
    AND NEW."status" <> OLD."status"
    AND NOT (retry_allowed AND OLD."status" = 'dead' AND NEW."status" = 'pending') THEN
    RAISE EXCEPTION 'Terminal export job cannot be reopened';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
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
    ELSE
      RAISE EXCEPTION 'Unsupported dead-letter source';
  END CASE;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retry_all_dead_letters()
RETURNS integer AS $$
DECLARE
  entry record;
  changed integer := 0;
BEGIN
  IF NOT public.app_platform_admin_context() THEN
    RAISE EXCEPTION 'Platform administrator access is required' USING ERRCODE = '42501';
  END IF;

  FOR entry IN SELECT source, source_id FROM public.list_dead_letters(500)
  LOOP
    IF public.retry_dead_letter(entry.source, entry.source_id) THEN
      changed := changed + 1;
    END IF;
  END LOOP;
  RETURN changed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
