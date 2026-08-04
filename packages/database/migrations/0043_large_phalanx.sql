UPDATE "form_responses"
SET "data" = '{}'::jsonb
WHERE "data" IS NULL;--> statement-breakpoint
UPDATE "form_responses" AS response
SET "created_task_id" = NULL
WHERE "created_task_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "tasks" AS task WHERE task."id" = response."created_task_id");--> statement-breakpoint
UPDATE "forms"
SET
  "fields" = COALESCE("fields", '[]'::jsonb),
  "settings" = '{"schemaVersion":1,"createTask":true,"status":"todo","priority":"medium","captchaEnabled":true}'::jsonb
    || COALESCE("settings", '{}'::jsonb)
    || '{"schemaVersion":1}'::jsonb,
  "responses" = COALESCE("responses", 0),
  "is_active" = COALESCE("is_active", true);--> statement-breakpoint
ALTER TABLE "form_responses" ALTER COLUMN "data" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "fields" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "settings" SET DEFAULT '{"schemaVersion":1,"createTask":true,"status":"todo","priority":"medium","captchaEnabled":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "settings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "responses" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "is_active" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_created_task_id_tasks_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_tenant_form_submitted_idx" ON "form_responses" USING btree ("organization_id","workspace_id","form_id","submitted_at");--> statement-breakpoint
CREATE INDEX "forms_tenant_active_created_idx" ON "forms" USING btree ("organization_id","workspace_id","deleted_at","is_active","created_at");--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_data_object_check" CHECK (jsonb_typeof("form_responses"."data") = 'object');--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_fields_array_check" CHECK (jsonb_typeof("forms"."fields") = 'array');--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_settings_version_check" CHECK (jsonb_typeof("forms"."settings") = 'object' and "forms"."settings"->>'schemaVersion' = '1');--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_responses_nonnegative_check" CHECK ("forms"."responses" >= 0);
