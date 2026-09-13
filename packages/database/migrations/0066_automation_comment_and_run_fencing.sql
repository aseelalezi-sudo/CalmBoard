ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "claim_token" varchar(128);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "deduplication_key" varchar(256);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comments_tenant_deduplication_unique" ON "comments" USING btree ("organization_id","workspace_id","deduplication_key") WHERE "comments"."deduplication_key" is not null;
