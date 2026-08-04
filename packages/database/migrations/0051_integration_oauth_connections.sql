CREATE TABLE "integration_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50) NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_oauth_states_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "integration_oauth_states_provider_check" CHECK ("integration_oauth_states"."provider" in ('github', 'slack', 'gcal', 'microsoft')),
	CONSTRAINT "integration_oauth_states_hash_check" CHECK ("integration_oauth_states"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "integration_oauth_states_expiry_check" CHECK ("integration_oauth_states"."expires_at" > "integration_oauth_states"."created_at")
);
--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expiry_idx" ON "integration_oauth_states" USING btree ("expires_at");
