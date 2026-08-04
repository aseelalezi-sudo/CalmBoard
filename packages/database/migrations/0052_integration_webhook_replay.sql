CREATE TABLE "integration_webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"endpoint_key_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_webhook_endpoints_endpoint_key_hash_unique" UNIQUE("endpoint_key_hash"),
	CONSTRAINT "integration_webhook_endpoints_provider_check" CHECK ("integration_webhook_endpoints"."provider" in ('github', 'slack', 'webhook')),
	CONSTRAINT "integration_webhook_endpoints_hash_check" CHECK ("integration_webhook_endpoints"."endpoint_key_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "integration_webhook_endpoints_status_check" CHECK ("integration_webhook_endpoints"."status" in ('active', 'revoked')),
	CONSTRAINT "integration_webhook_endpoints_revocation_check" CHECK (("integration_webhook_endpoints"."status" = 'revoked' and "integration_webhook_endpoints"."revoked_at" is not null) or ("integration_webhook_endpoints"."status" = 'active' and "integration_webhook_endpoints"."revoked_at" is null))
);
--> statement-breakpoint
CREATE TABLE "integration_webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"payload_sha256" varchar(64) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"provider_timestamp" timestamp with time zone,
	"status" varchar(20) DEFAULT 'processed' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_webhook_receipts_provider_check" CHECK ("integration_webhook_receipts"."provider" in ('github', 'slack', 'webhook')),
	CONSTRAINT "integration_webhook_receipts_delivery_check" CHECK (length("integration_webhook_receipts"."delivery_id") between 8 and 255),
	CONSTRAINT "integration_webhook_receipts_payload_hash_check" CHECK ("integration_webhook_receipts"."payload_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "integration_webhook_receipts_status_check" CHECK ("integration_webhook_receipts"."status" = 'processed'),
	CONSTRAINT "integration_webhook_receipts_time_check" CHECK ("integration_webhook_receipts"."processed_at" >= "integration_webhook_receipts"."received_at")
);
--> statement-breakpoint
ALTER TABLE "integration_webhook_endpoints" ADD CONSTRAINT "integration_webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_endpoints" ADD CONSTRAINT "integration_webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_endpoints" ADD CONSTRAINT "integration_webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_receipts" ADD CONSTRAINT "integration_webhook_receipts_endpoint_id_integration_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."integration_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_receipts" ADD CONSTRAINT "integration_webhook_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_receipts" ADD CONSTRAINT "integration_webhook_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_webhook_endpoints_tenant_status_idx" ON "integration_webhook_endpoints" USING btree ("organization_id","workspace_id","status","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_receipts_endpoint_delivery_unique" ON "integration_webhook_receipts" USING btree ("endpoint_id","delivery_id");--> statement-breakpoint
CREATE INDEX "integration_webhook_receipts_tenant_received_idx" ON "integration_webhook_receipts" USING btree ("organization_id","workspace_id","received_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_integration_webhook_endpoint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspaces workspace
    WHERE workspace.id = NEW.workspace_id
      AND workspace.organization_id = NEW.organization_id
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Integration webhook endpoint workspace does not belong to its organization'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM public.memberships membership
    WHERE membership.user_id = NEW.created_by
      AND membership.organization_id = NEW.organization_id
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
      AND (membership.workspace_id IS NULL OR membership.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Integration webhook endpoints require an active owner or admin membership'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id <> OLD.organization_id
      OR NEW.workspace_id <> OLD.workspace_id
      OR NEW.provider <> OLD.provider
      OR NEW.endpoint_key_hash <> OLD.endpoint_key_hash
      OR NEW.created_by <> OLD.created_by
      OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Integration webhook endpoint identity is immutable'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'A revoked integration webhook endpoint cannot be restored or rewritten'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER integration_webhook_endpoints_validate_scope
BEFORE INSERT OR UPDATE ON public.integration_webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION public.validate_integration_webhook_endpoint();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_integration_webhook_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Integration webhook receipts are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.integration_webhook_endpoints endpoint
    WHERE endpoint.id = NEW.endpoint_id
      AND endpoint.organization_id = NEW.organization_id
      AND endpoint.workspace_id = NEW.workspace_id
      AND endpoint.provider = NEW.provider
      AND endpoint.status = 'active'
      AND endpoint.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Integration webhook receipt must match an active endpoint tenant and provider'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER integration_webhook_receipts_validate_scope
BEFORE INSERT OR UPDATE ON public.integration_webhook_receipts
FOR EACH ROW EXECUTE FUNCTION public.validate_integration_webhook_receipt();--> statement-breakpoint
ALTER TABLE public.integration_webhook_endpoints ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.integration_webhook_endpoints FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.integration_webhook_endpoints
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));--> statement-breakpoint
ALTER TABLE public.integration_webhook_receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.integration_webhook_receipts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.integration_webhook_receipts
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.resolve_integration_webhook_endpoint(
  requested_provider text,
  requested_endpoint_key_hash text
)
RETURNS TABLE (endpoint_id uuid, organization_id uuid, workspace_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT endpoint.id, endpoint.organization_id, endpoint.workspace_id
  FROM public.integration_webhook_endpoints endpoint
  WHERE endpoint.provider = requested_provider
    AND endpoint.endpoint_key_hash = requested_endpoint_key_hash
    AND endpoint.status = 'active'
    AND endpoint.revoked_at IS NULL
  LIMIT 1;
$$;
