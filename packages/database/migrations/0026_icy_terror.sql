ALTER TABLE "attachments" ADD COLUMN "cleanup_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "cleanup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "cleanup_error" text;--> statement-breakpoint
CREATE INDEX "attachments_cleanup_candidates_idx" ON "attachments" USING btree ("cleanup_claimed_at","cleanup_attempts","scan_status","updated_at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_cleanup_attempts_check" CHECK ("attachments"."cleanup_attempts" >= 0);