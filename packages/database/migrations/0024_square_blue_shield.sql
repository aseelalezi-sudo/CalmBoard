ALTER TABLE "attachments" ADD COLUMN "scan_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scan_engine" varchar(100);--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scan_signature" varchar(255);--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "attachments_tenant_scan_status_idx" ON "attachments" USING btree ("organization_id","workspace_id","scan_status","created_at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_scan_status_check" CHECK ("attachments"."scan_status" in ('pending', 'clean', 'infected', 'failed'));