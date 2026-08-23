ALTER TABLE "saved_views" DROP CONSTRAINT IF EXISTS "saved_views_configuration_version_check";--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_configuration_version_check" CHECK (jsonb_typeof("saved_views"."configuration") = 'object' and "saved_views"."configuration"->>'schemaVersion' in ('1', '2'));
