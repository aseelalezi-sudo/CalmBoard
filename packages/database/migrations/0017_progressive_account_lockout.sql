ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_locked_until_idx" ON "users" USING btree ("locked_until");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_failed_login_attempts_check" CHECK ("users"."failed_login_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_lock_state_check" CHECK ("users"."failed_login_attempts" < 5 or "users"."locked_until" is not null);