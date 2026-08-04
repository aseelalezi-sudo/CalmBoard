CREATE TYPE "public"."security_event_outcome" AS ENUM('success', 'failure', 'blocked', 'challenge');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('account_registered', 'login_password', 'login_oauth', 'login_mfa', 'logout', 'email_verified', 'password_reset_requested', 'password_reset_completed', 'mfa_enabled', 'mfa_disabled', 'session_revoked', 'sessions_revoked');--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" "security_event_type" NOT NULL,
	"outcome" "security_event_outcome" NOT NULL,
	"email_hash" varchar(64),
	"session_id" uuid,
	"provider" "oauth_provider",
	"ip" varchar(64),
	"user_agent" varchar(500),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_events_identity_check" CHECK ("security_events"."user_id" is not null or "security_events"."email_hash" is not null or "security_events"."session_id" is not null or "security_events"."ip" is not null),
	CONSTRAINT "security_events_email_hash_check" CHECK ("security_events"."email_hash" is null or "security_events"."email_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "security_events_user_created_idx" ON "security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_events_type_created_idx" ON "security_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "security_events_email_created_idx" ON "security_events" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'Security events are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER security_events_append_only
BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_event_mutation();
