CREATE TYPE "public"."ai_proposal_status" AS ENUM('pending', 'executed', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "ai_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"kind" varchar(32) DEFAULT 'create_tasks' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"status" "ai_proposal_status" DEFAULT 'pending' NOT NULL,
	"provider" varchar(50) NOT NULL,
	"model" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_action_proposals_action_check" CHECK ("ai_action_proposals"."action" ~ '^[a-z_]{2,32}$'),
	CONSTRAINT "ai_action_proposals_kind_check" CHECK ("ai_action_proposals"."kind" = 'create_tasks'),
	CONSTRAINT "ai_action_proposals_digest_check" CHECK ("ai_action_proposals"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_action_proposals_payload_check" CHECK (jsonb_typeof("ai_action_proposals"."payload") = 'array' and jsonb_array_length("ai_action_proposals"."payload") between 1 and 50),
	CONSTRAINT "ai_action_proposals_expiry_check" CHECK ("ai_action_proposals"."expires_at" > "ai_action_proposals"."created_at"),
	CONSTRAINT "ai_action_proposals_state_check" CHECK (("ai_action_proposals"."status" = 'pending' and "ai_action_proposals"."approved_at" is null and "ai_action_proposals"."rejected_at" is null and "ai_action_proposals"."expired_at" is null and "ai_action_proposals"."executed_at" is null)
        or ("ai_action_proposals"."status" = 'executed' and "ai_action_proposals"."approved_at" is not null and "ai_action_proposals"."executed_at" is not null and "ai_action_proposals"."rejected_at" is null and "ai_action_proposals"."expired_at" is null)
        or ("ai_action_proposals"."status" = 'rejected' and "ai_action_proposals"."rejected_at" is not null and "ai_action_proposals"."approved_at" is null and "ai_action_proposals"."expired_at" is null and "ai_action_proposals"."executed_at" is null)
        or ("ai_action_proposals"."status" = 'expired' and "ai_action_proposals"."expired_at" is not null and "ai_action_proposals"."approved_at" is null and "ai_action_proposals"."rejected_at" is null and "ai_action_proposals"."executed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_action_proposals_tenant_status_expiry_idx" ON "ai_action_proposals" USING btree ("organization_id","workspace_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "ai_action_proposals_actor_status_idx" ON "ai_action_proposals" USING btree ("actor_id","status","created_at");
--> statement-breakpoint
ALTER TABLE public.ai_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.ai_action_proposals
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
