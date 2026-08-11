CREATE TABLE "comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"invitation_id" uuid NOT NULL,
	"token_version" integer NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"encrypted_payload" text,
	"initialization_vector" varchar(24),
	"authentication_tag" varchar(24),
	"encryption_algorithm" varchar(20) DEFAULT 'aes-256-gcm' NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"status" "notification_email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_email_outbox_token_version_check" CHECK ("invitation_email_outbox"."token_version" > 0),
	CONSTRAINT "invitation_email_outbox_cipher_check" CHECK ("invitation_email_outbox"."encryption_algorithm" = 'aes-256-gcm' and "invitation_email_outbox"."encryption_key_version" > 0),
	CONSTRAINT "invitation_email_outbox_payload_check" CHECK (("invitation_email_outbox"."encrypted_payload" is null and "invitation_email_outbox"."initialization_vector" is null and "invitation_email_outbox"."authentication_tag" is null) or ("invitation_email_outbox"."encrypted_payload" is not null and "invitation_email_outbox"."initialization_vector" is not null and "invitation_email_outbox"."authentication_tag" is not null)),
	CONSTRAINT "invitation_email_outbox_attempts_check" CHECK ("invitation_email_outbox"."attempts" >= 0 and "invitation_email_outbox"."max_attempts" > 0),
	CONSTRAINT "invitation_email_outbox_terminal_state_check" CHECK (("invitation_email_outbox"."status" = 'sent' and "invitation_email_outbox"."sent_at" is not null) or ("invitation_email_outbox"."status" <> 'sent' and "invitation_email_outbox"."sent_at" is null)),
	CONSTRAINT "invitation_email_outbox_claim_state_check" CHECK (("invitation_email_outbox"."status" = 'processing' and "invitation_email_outbox"."claimed_at" is not null and "invitation_email_outbox"."claim_token" is not null) or ("invitation_email_outbox"."status" <> 'processing' and "invitation_email_outbox"."claimed_at" is null and "invitation_email_outbox"."claim_token" is null))
);
--> statement-breakpoint
CREATE TABLE "user_onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_onboarding_progress_steps_array_check" CHECK (jsonb_typeof("user_onboarding_progress"."completed_steps") = 'array')
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "deduplication_key" varchar(256);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "action_path" text;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_email_outbox" ADD CONSTRAINT "invitation_email_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_email_outbox" ADD CONSTRAINT "invitation_email_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_email_outbox" ADD CONSTRAINT "invitation_email_outbox_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_comment_user_unique" ON "comment_mentions" USING btree ("comment_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_tenant_task_idx" ON "comment_mentions" USING btree ("organization_id","workspace_id","task_id","comment_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_tenant_user_idx" ON "comment_mentions" USING btree ("organization_id","workspace_id","mentioned_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_email_outbox_invitation_version_unique" ON "invitation_email_outbox" USING btree ("invitation_id","token_version");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_email_outbox_idempotency_unique" ON "invitation_email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invitation_email_outbox_due_idx" ON "invitation_email_outbox" USING btree ("status","available_at","claimed_at");--> statement-breakpoint
CREATE INDEX "invitation_email_outbox_tenant_status_idx" ON "invitation_email_outbox" USING btree ("organization_id","workspace_id","status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_onboarding_progress_user_workspace_unique" ON "user_onboarding_progress" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "user_onboarding_progress_tenant_user_idx" ON "user_onboarding_progress" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash") WHERE "invitations"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "invitations_pending_expiry_idx" ON "invitations" USING btree ("organization_id","workspace_id","expires_at") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_user_deduplication_unique" ON "notifications" USING btree ("organization_id","user_id","deduplication_key") WHERE "notifications"."deduplication_key" is not null;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_version_check" CHECK ("invitations"."token_version" >= 0);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_pair_check" CHECK (("invitations"."token_hash" is null and "invitations"."expires_at" is null) or ("invitations"."token_hash" is not null and "invitations"."expires_at" is not null));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_terminal_timestamp_check" CHECK (num_nonnulls("invitations"."accepted_at", "invitations"."revoked_at", "invitations"."declined_at") <= 1);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_action_path_check" CHECK ("notifications"."action_path" is null or (left("notifications"."action_path", 1) = '/' and left("notifications"."action_path", 2) <> '//'));
--> statement-breakpoint
ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.comment_mentions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.comment_mentions
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
--> statement-breakpoint
ALTER TABLE public.invitation_email_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invitation_email_outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.invitation_email_outbox
USING (public.app_tenant_matches(organization_id, workspace_id, true))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id, true));
--> statement-breakpoint
ALTER TABLE public.user_onboarding_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.user_onboarding_progress FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.user_onboarding_progress
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
