CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'processing', 'completed', 'dead', 'expired');--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"format" varchar(20) DEFAULT 'json' NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"status" "export_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"object_key" text,
	"file_name" varchar(255),
	"content_type" varchar(100),
	"file_size" bigint,
	"checksum_sha256" varchar(64),
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_jobs_format_check" CHECK ("export_jobs"."format" = 'json'),
	CONSTRAINT "export_jobs_attempts_check" CHECK ("export_jobs"."attempts" >= 0 and "export_jobs"."max_attempts" > 0),
	CONSTRAINT "export_jobs_claim_state_check" CHECK (("export_jobs"."status" = 'processing' and "export_jobs"."claimed_at" is not null and "export_jobs"."claim_token" is not null) or ("export_jobs"."status" <> 'processing' and "export_jobs"."claimed_at" is null and "export_jobs"."claim_token" is null)),
	CONSTRAINT "export_jobs_result_state_check" CHECK (("export_jobs"."status" in ('completed', 'expired') and "export_jobs"."object_key" is not null and "export_jobs"."file_name" is not null and "export_jobs"."content_type" is not null and "export_jobs"."file_size" is not null and "export_jobs"."checksum_sha256" is not null and "export_jobs"."completed_at" is not null and "export_jobs"."expires_at" is not null) or ("export_jobs"."status" not in ('completed', 'expired') and "export_jobs"."object_key" is null and "export_jobs"."file_name" is null and "export_jobs"."content_type" is null and "export_jobs"."file_size" is null and "export_jobs"."checksum_sha256" is null and "export_jobs"."completed_at" is null and "export_jobs"."expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_idempotency_unique" ON "export_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_requester_idx" ON "export_jobs" USING btree ("organization_id","workspace_id","requested_by","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_due_idx" ON "export_jobs" USING btree ("status","available_at","claimed_at");
--> statement-breakpoint
CREATE FUNCTION "validate_export_job"() RETURNS trigger AS $$
DECLARE
  workspace_organization_id uuid;
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
    OR NEW."max_attempts" <> OLD."max_attempts"
  ) THEN
    RAISE EXCEPTION 'Export job identity is immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Export job attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('completed', 'dead', 'expired')
    AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Terminal export job cannot be reopened';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "export_jobs_validate"
BEFORE INSERT OR UPDATE ON "export_jobs"
FOR EACH ROW EXECUTE FUNCTION "validate_export_job"();
--> statement-breakpoint
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.export_jobs
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
