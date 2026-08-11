CREATE TYPE "public"."deletion_receipt_outcome" AS ENUM('anonymized', 'purged');--> statement-breakpoint
CREATE TYPE "public"."deletion_request_status" AS ENUM('requested', 'scheduled', 'processing', 'retry_wait', 'failed', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."deletion_subject_type" AS ENUM('account', 'organization');--> statement-breakpoint
CREATE TYPE "public"."organization_lifecycle_state" AS ENUM('active', 'deletion_pending', 'write_frozen');--> statement-breakpoint
CREATE TYPE "public"."purge_checkpoint_status" AS ENUM('pending', 'processing', 'retry_wait', 'failed', 'verified');--> statement-breakpoint
CREATE TYPE "public"."purge_domain" AS ENUM('account_security', 'account_profile', 'account_memberships', 'organization_relational', 'attachments', 'attachment_previews', 'documents', 'exports', 'reports', 'integration_oauth', 'billing_provider', 'final_verification');--> statement-breakpoint
CREATE TYPE "public"."purge_item_status" AS ENUM('pending', 'processing', 'retry_wait', 'failed', 'completed', 'verified');--> statement-breakpoint
CREATE TYPE "public"."purge_locator_kind" AS ENUM('sql_keyset', 'object_key', 'provider_resource');--> statement-breakpoint
CREATE TYPE "public"."user_lifecycle_state" AS ENUM('active', 'deletion_pending', 'auth_disabled', 'anonymized');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "deletion_request_status" DEFAULT 'requested' NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauthenticated_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(64),
	"last_error_summary" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_requests_attempts_check" CHECK ("account_deletion_requests"."attempts" >= 0),
	CONSTRAINT "account_deletion_requests_schedule_check" CHECK ("account_deletion_requests"."scheduled_for" is null or "account_deletion_requests"."scheduled_for" >= "account_deletion_requests"."requested_at"),
	CONSTRAINT "account_deletion_requests_reauthentication_check" CHECK ("account_deletion_requests"."reauthenticated_at" <= "account_deletion_requests"."requested_at"),
	CONSTRAINT "account_deletion_requests_processing_history_check" CHECK (("account_deletion_requests"."status" in ('requested', 'scheduled', 'canceled') and "account_deletion_requests"."processing_started_at" is null)
          or ("account_deletion_requests"."status" in ('processing', 'retry_wait', 'failed', 'completed') and "account_deletion_requests"."processing_started_at" is not null)),
	CONSTRAINT "account_deletion_requests_claim_state_check" CHECK (("account_deletion_requests"."status" = 'processing' and "account_deletion_requests"."claim_token" is not null and "account_deletion_requests"."claimed_at" is not null and "account_deletion_requests"."heartbeat_at" is not null)
          or ("account_deletion_requests"."status" <> 'processing' and "account_deletion_requests"."claim_token" is null and "account_deletion_requests"."claimed_at" is null and "account_deletion_requests"."heartbeat_at" is null)),
	CONSTRAINT "account_deletion_requests_retry_state_check" CHECK (("account_deletion_requests"."status" = 'retry_wait' and "account_deletion_requests"."retry_at" is not null) or ("account_deletion_requests"."status" <> 'retry_wait' and "account_deletion_requests"."retry_at" is null)),
	CONSTRAINT "account_deletion_requests_terminal_state_check" CHECK (("account_deletion_requests"."status" = 'completed' and "account_deletion_requests"."completed_at" is not null and "account_deletion_requests"."canceled_at" is null)
          or ("account_deletion_requests"."status" = 'canceled' and "account_deletion_requests"."canceled_at" is not null and "account_deletion_requests"."completed_at" is null and "account_deletion_requests"."processing_started_at" is null)
          or ("account_deletion_requests"."status" not in ('completed', 'canceled') and "account_deletion_requests"."completed_at" is null and "account_deletion_requests"."canceled_at" is null)),
	CONSTRAINT "account_deletion_requests_failed_state_check" CHECK ("account_deletion_requests"."status" <> 'failed' or "account_deletion_requests"."failed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "data_deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "deletion_subject_type" NOT NULL,
	"outcome" "deletion_receipt_outcome" NOT NULL,
	"schema_version" smallint NOT NULL,
	"verification_version" varchar(64) NOT NULL,
	"domain_summary" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_deletion_receipts_schema_version_check" CHECK ("data_deletion_receipts"."schema_version" > 0),
	CONSTRAINT "data_deletion_receipts_domain_summary_check" CHECK (jsonb_typeof("data_deletion_receipts"."domain_summary") = 'object')
);
--> statement-breakpoint
CREATE TABLE "data_purge_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_request_id" uuid,
	"organization_request_id" uuid,
	"domain" "purge_domain" NOT NULL,
	"partition_key" varchar(128) DEFAULT 'default' NOT NULL,
	"status" "purge_checkpoint_status" DEFAULT 'pending' NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"batch_size" integer NOT NULL,
	"discovered_count" bigint DEFAULT 0 NOT NULL,
	"completed_count" bigint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"last_error_summary" varchar(512),
	"last_batch_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_purge_checkpoints_parent_xor_check" CHECK (num_nonnulls("data_purge_checkpoints"."account_request_id", "data_purge_checkpoints"."organization_request_id") = 1),
	CONSTRAINT "data_purge_checkpoints_batch_size_check" CHECK ("data_purge_checkpoints"."batch_size" between 1 and 10000),
	CONSTRAINT "data_purge_checkpoints_counts_check" CHECK ("data_purge_checkpoints"."discovered_count" >= 0 and "data_purge_checkpoints"."completed_count" >= 0 and "data_purge_checkpoints"."completed_count" <= "data_purge_checkpoints"."discovered_count"),
	CONSTRAINT "data_purge_checkpoints_attempts_check" CHECK ("data_purge_checkpoints"."attempts" >= 0),
	CONSTRAINT "data_purge_checkpoints_cursor_check" CHECK (jsonb_typeof("data_purge_checkpoints"."cursor") = 'object'),
	CONSTRAINT "data_purge_checkpoints_claim_state_check" CHECK (("data_purge_checkpoints"."status" = 'processing' and "data_purge_checkpoints"."claim_token" is not null and "data_purge_checkpoints"."claimed_at" is not null and "data_purge_checkpoints"."heartbeat_at" is not null)
          or ("data_purge_checkpoints"."status" <> 'processing' and "data_purge_checkpoints"."claim_token" is null and "data_purge_checkpoints"."claimed_at" is null and "data_purge_checkpoints"."heartbeat_at" is null)),
	CONSTRAINT "data_purge_checkpoints_retry_state_check" CHECK (("data_purge_checkpoints"."status" = 'retry_wait' and "data_purge_checkpoints"."retry_at" is not null) or ("data_purge_checkpoints"."status" <> 'retry_wait' and "data_purge_checkpoints"."retry_at" is null)),
	CONSTRAINT "data_purge_checkpoints_verified_state_check" CHECK (("data_purge_checkpoints"."status" = 'verified' and "data_purge_checkpoints"."verified_at" is not null) or "data_purge_checkpoints"."status" <> 'verified')
);
--> statement-breakpoint
CREATE TABLE "data_purge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_request_id" uuid,
	"organization_request_id" uuid,
	"domain" "purge_domain" NOT NULL,
	"locator_kind" "purge_locator_kind" NOT NULL,
	"locator" jsonb NOT NULL,
	"locator_fingerprint" varchar(64) NOT NULL,
	"status" "purge_item_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"last_error_summary" varchar(512),
	"completed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_purge_items_parent_xor_check" CHECK (num_nonnulls("data_purge_items"."account_request_id", "data_purge_items"."organization_request_id") = 1),
	CONSTRAINT "data_purge_items_attempts_check" CHECK ("data_purge_items"."attempts" >= 0),
	CONSTRAINT "data_purge_items_locator_check" CHECK (jsonb_typeof("data_purge_items"."locator") = 'object'),
	CONSTRAINT "data_purge_items_fingerprint_check" CHECK ("data_purge_items"."locator_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "data_purge_items_claim_state_check" CHECK (("data_purge_items"."status" = 'processing' and "data_purge_items"."claim_token" is not null and "data_purge_items"."claimed_at" is not null and "data_purge_items"."heartbeat_at" is not null)
          or ("data_purge_items"."status" <> 'processing' and "data_purge_items"."claim_token" is null and "data_purge_items"."claimed_at" is null and "data_purge_items"."heartbeat_at" is null)),
	CONSTRAINT "data_purge_items_retry_state_check" CHECK (("data_purge_items"."status" = 'retry_wait' and "data_purge_items"."retry_at" is not null) or ("data_purge_items"."status" <> 'retry_wait' and "data_purge_items"."retry_at" is null)),
	CONSTRAINT "data_purge_items_completed_state_check" CHECK (("data_purge_items"."status" in ('completed', 'verified') and "data_purge_items"."completed_at" is not null) or "data_purge_items"."status" not in ('completed', 'verified')),
	CONSTRAINT "data_purge_items_verified_state_check" CHECK (("data_purge_items"."status" = 'verified' and "data_purge_items"."verified_at" is not null) or "data_purge_items"."status" <> 'verified')
);
--> statement-breakpoint
CREATE TABLE "organization_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"status" "deletion_request_status" DEFAULT 'requested' NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"confirmation_version" varchar(64) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauthenticated_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(64),
	"last_error_summary" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_deletion_requests_attempts_check" CHECK ("organization_deletion_requests"."attempts" >= 0),
	CONSTRAINT "organization_deletion_requests_schedule_check" CHECK ("organization_deletion_requests"."scheduled_for" is null or "organization_deletion_requests"."scheduled_for" >= "organization_deletion_requests"."requested_at"),
	CONSTRAINT "organization_deletion_requests_reauthentication_check" CHECK ("organization_deletion_requests"."reauthenticated_at" <= "organization_deletion_requests"."requested_at"),
	CONSTRAINT "organization_deletion_requests_processing_history_check" CHECK (("organization_deletion_requests"."status" in ('requested', 'scheduled', 'canceled') and "organization_deletion_requests"."processing_started_at" is null)
          or ("organization_deletion_requests"."status" in ('processing', 'retry_wait', 'failed', 'completed') and "organization_deletion_requests"."processing_started_at" is not null)),
	CONSTRAINT "organization_deletion_requests_claim_state_check" CHECK (("organization_deletion_requests"."status" = 'processing' and "organization_deletion_requests"."claim_token" is not null and "organization_deletion_requests"."claimed_at" is not null and "organization_deletion_requests"."heartbeat_at" is not null)
          or ("organization_deletion_requests"."status" <> 'processing' and "organization_deletion_requests"."claim_token" is null and "organization_deletion_requests"."claimed_at" is null and "organization_deletion_requests"."heartbeat_at" is null)),
	CONSTRAINT "organization_deletion_requests_retry_state_check" CHECK (("organization_deletion_requests"."status" = 'retry_wait' and "organization_deletion_requests"."retry_at" is not null) or ("organization_deletion_requests"."status" <> 'retry_wait' and "organization_deletion_requests"."retry_at" is null)),
	CONSTRAINT "organization_deletion_requests_terminal_state_check" CHECK (("organization_deletion_requests"."status" = 'completed' and "organization_deletion_requests"."completed_at" is not null and "organization_deletion_requests"."canceled_at" is null)
          or ("organization_deletion_requests"."status" = 'canceled' and "organization_deletion_requests"."canceled_at" is not null and "organization_deletion_requests"."completed_at" is null and "organization_deletion_requests"."processing_started_at" is null)
          or ("organization_deletion_requests"."status" not in ('completed', 'canceled') and "organization_deletion_requests"."completed_at" is null and "organization_deletion_requests"."canceled_at" is null)),
	CONSTRAINT "organization_deletion_requests_failed_state_check" CHECK ("organization_deletion_requests"."status" <> 'failed' or "organization_deletion_requests"."failed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "lifecycle_state" "organization_lifecycle_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "write_frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lifecycle_state" "user_lifecycle_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_purge_checkpoints" ADD CONSTRAINT "data_purge_checkpoints_account_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("account_request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_purge_checkpoints" ADD CONSTRAINT "data_purge_checkpoints_organization_request_id_organization_deletion_requests_id_fk" FOREIGN KEY ("organization_request_id") REFERENCES "public"."organization_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_purge_items" ADD CONSTRAINT "data_purge_items_account_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("account_request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_purge_items" ADD CONSTRAINT "data_purge_items_organization_request_id_organization_deletion_requests_id_fk" FOREIGN KEY ("organization_request_id") REFERENCES "public"."organization_deletion_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_deletion_requests" ADD CONSTRAINT "organization_deletion_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_deletion_requests" ADD CONSTRAINT "organization_deletion_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_active_user_unique" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" in ('requested', 'scheduled', 'processing', 'retry_wait', 'failed');--> statement-breakpoint
CREATE INDEX "account_deletion_requests_due_idx" ON "account_deletion_requests" USING btree ("status","scheduled_for","retry_at") WHERE "account_deletion_requests"."status" in ('scheduled', 'retry_wait');--> statement-breakpoint
CREATE INDEX "account_deletion_requests_stale_claim_idx" ON "account_deletion_requests" USING btree ("status","heartbeat_at") WHERE "account_deletion_requests"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "account_deletion_requests_user_created_idx" ON "account_deletion_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_deletion_receipts_completed_idx" ON "data_deletion_receipts" USING btree ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_purge_checkpoints_account_domain_partition_unique" ON "data_purge_checkpoints" USING btree ("account_request_id","domain","partition_key") WHERE "data_purge_checkpoints"."account_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "data_purge_checkpoints_org_domain_partition_unique" ON "data_purge_checkpoints" USING btree ("organization_request_id","domain","partition_key") WHERE "data_purge_checkpoints"."organization_request_id" is not null;--> statement-breakpoint
CREATE INDEX "data_purge_checkpoints_due_idx" ON "data_purge_checkpoints" USING btree ("status","retry_at","created_at");--> statement-breakpoint
CREATE INDEX "data_purge_checkpoints_stale_claim_idx" ON "data_purge_checkpoints" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_purge_items_account_domain_fingerprint_unique" ON "data_purge_items" USING btree ("account_request_id","domain","locator_fingerprint") WHERE "data_purge_items"."account_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "data_purge_items_org_domain_fingerprint_unique" ON "data_purge_items" USING btree ("organization_request_id","domain","locator_fingerprint") WHERE "data_purge_items"."organization_request_id" is not null;--> statement-breakpoint
CREATE INDEX "data_purge_items_due_idx" ON "data_purge_items" USING btree ("status","retry_at","created_at");--> statement-breakpoint
CREATE INDEX "data_purge_items_stale_claim_idx" ON "data_purge_items" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_deletion_requests_active_org_unique" ON "organization_deletion_requests" USING btree ("organization_id") WHERE "organization_deletion_requests"."status" in ('requested', 'scheduled', 'processing', 'retry_wait', 'failed');--> statement-breakpoint
CREATE INDEX "organization_deletion_requests_due_idx" ON "organization_deletion_requests" USING btree ("status","scheduled_for","retry_at") WHERE "organization_deletion_requests"."status" in ('scheduled', 'retry_wait');--> statement-breakpoint
CREATE INDEX "organization_deletion_requests_stale_claim_idx" ON "organization_deletion_requests" USING btree ("status","heartbeat_at") WHERE "organization_deletion_requests"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "organization_deletion_requests_org_created_idx" ON "organization_deletion_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_lifecycle_state_check" CHECK (("organizations"."lifecycle_state" in ('active', 'deletion_pending') and "organizations"."write_frozen_at" is null)
        or ("organizations"."lifecycle_state" = 'write_frozen' and "organizations"."write_frozen_at" is not null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lifecycle_state_check" CHECK (("users"."lifecycle_state" = 'active' and "users"."auth_disabled_at" is null and "users"."anonymized_at" is null)
          or ("users"."lifecycle_state" = 'deletion_pending' and "users"."anonymized_at" is null)
          or ("users"."lifecycle_state" = 'auth_disabled' and "users"."auth_disabled_at" is not null and "users"."anonymized_at" is null)
          or ("users"."lifecycle_state" = 'anonymized' and "users"."auth_disabled_at" is not null and "users"."anonymized_at" is not null));
--> statement-breakpoint
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_deletion_requests_select ON public.account_deletion_requests
FOR SELECT
USING (user_id = public.app_current_actor_id());
--> statement-breakpoint
CREATE POLICY account_deletion_requests_insert ON public.account_deletion_requests
FOR INSERT
WITH CHECK (user_id = public.app_current_actor_id() AND status = 'requested');
--> statement-breakpoint
CREATE POLICY account_deletion_requests_schedule_or_cancel ON public.account_deletion_requests
FOR UPDATE
USING (user_id = public.app_current_actor_id() AND status IN ('requested', 'scheduled'))
WITH CHECK (user_id = public.app_current_actor_id() AND status IN ('scheduled', 'canceled'));
--> statement-breakpoint
ALTER TABLE public.organization_deletion_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.organization_deletion_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_deletion_requests_select ON public.organization_deletion_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.organizations organization
    WHERE organization.id = organization_deletion_requests.organization_id
      AND organization.owner_id = public.app_current_actor_id()
      AND organization.deleted_at IS NULL
  )
);
--> statement-breakpoint
CREATE POLICY organization_deletion_requests_insert ON public.organization_deletion_requests
FOR INSERT
WITH CHECK (
  requested_by_user_id = public.app_current_actor_id()
  AND status = 'requested'
  AND EXISTS (
    SELECT 1
    FROM public.organizations organization
    WHERE organization.id = organization_deletion_requests.organization_id
      AND organization.owner_id = public.app_current_actor_id()
      AND organization.deleted_at IS NULL
      AND organization.lifecycle_state = 'active'
  )
);
--> statement-breakpoint
CREATE POLICY organization_deletion_requests_schedule_or_cancel ON public.organization_deletion_requests
FOR UPDATE
USING (
  requested_by_user_id = public.app_current_actor_id()
  AND status IN ('requested', 'scheduled')
  AND EXISTS (
    SELECT 1
    FROM public.organizations organization
    WHERE organization.id = organization_deletion_requests.organization_id
      AND organization.owner_id = public.app_current_actor_id()
      AND organization.deleted_at IS NULL
      AND organization.lifecycle_state IN ('active', 'deletion_pending')
  )
)
WITH CHECK (
  requested_by_user_id = public.app_current_actor_id()
  AND status IN ('scheduled', 'canceled')
);
--> statement-breakpoint
ALTER TABLE public.data_purge_checkpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_purge_checkpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_purge_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_purge_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_deletion_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_deletion_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY organizations_delete ON public.organizations;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_enforce_organization_write_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_organization_id uuid;
  caller_role_name name;
  caller_can_maintain boolean;
BEGIN
  caller_role_name := COALESCE(
    NULLIF(current_setting('role', true), 'none'),
    session_user::text
  )::name;

  SELECT role.rolsuper OR role.rolbypassrls
    INTO caller_can_maintain
    FROM pg_catalog.pg_roles role
   WHERE role.rolname = caller_role_name;

  IF COALESCE(caller_can_maintain, false) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'organizations' THEN
    target_organization_id := (to_jsonb(OLD)->>'id')::uuid;
  ELSE
    target_organization_id := COALESCE(
      (to_jsonb(NEW)->>'organization_id')::uuid,
      (to_jsonb(OLD)->>'organization_id')::uuid
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.organizations organization
     WHERE organization.id = target_organization_id
       AND organization.lifecycle_state = 'write_frozen'
  ) THEN
    RAISE EXCEPTION 'Organization is write-frozen'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enforce_organization_write_freeze() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT column_metadata.table_name
      FROM information_schema.columns column_metadata
     WHERE column_metadata.table_schema = 'public'
       AND column_metadata.column_name = 'organization_id'
     ORDER BY column_metadata.table_name
  LOOP
    EXECUTE format(
      'CREATE TRIGGER enforce_organization_write_freeze BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.app_enforce_organization_write_freeze()',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER enforce_organization_write_freeze
BEFORE UPDATE OR DELETE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.app_enforce_organization_write_freeze();
