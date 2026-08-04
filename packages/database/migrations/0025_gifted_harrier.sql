ALTER TABLE "attachments" ADD COLUMN "preview_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "preview_reference" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "preview_mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "preview_width" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "preview_height" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_preview_status_check" CHECK ("attachments"."preview_status" in ('pending', 'ready', 'source', 'unsupported', 'failed'));