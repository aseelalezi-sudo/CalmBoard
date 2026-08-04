CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TABLE "oauth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_login_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_login_states_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "oauth_login_states_hash_check" CHECK ("oauth_login_states"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "oauth_login_states_expiry_check" CHECK ("oauth_login_states"."expires_at" > "oauth_login_states"."created_at")
);
--> statement-breakpoint
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_provider_subject_unique" ON "oauth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_user_provider_unique" ON "oauth_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_identities_email_idx" ON "oauth_identities" USING btree ("email");--> statement-breakpoint
CREATE INDEX "oauth_login_states_expiry_idx" ON "oauth_login_states" USING btree ("expires_at");