DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_event_status') THEN
    CREATE TYPE "public"."automation_event_status" AS ENUM('pending', 'processing', 'sent', 'skipped', 'dead');
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "automation_events" DROP CONSTRAINT IF EXISTS "automation_events_terminal_state_check";
--> statement-breakpoint
ALTER TABLE "automation_events" DROP CONSTRAINT IF EXISTS "automation_events_claim_state_check";
--> statement-breakpoint
ALTER TABLE "automation_events" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "automation_events" ALTER COLUMN "status" TYPE "public"."automation_event_status" USING (
  CASE "status"::text
    WHEN 'pending' THEN 'pending'::"public"."automation_event_status"
    WHEN 'processing' THEN 'processing'::"public"."automation_event_status"
    WHEN 'sent' THEN 'sent'::"public"."automation_event_status"
    WHEN 'skipped' THEN 'skipped'::"public"."automation_event_status"
    WHEN 'dead' THEN 'dead'::"public"."automation_event_status"
    ELSE 'pending'::"public"."automation_event_status"
  END
);
--> statement-breakpoint
ALTER TABLE "automation_events" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_terminal_state_check" CHECK (("automation_events"."status" in ('sent', 'skipped') and "automation_events"."completed_at" is not null) or ("automation_events"."status" not in ('sent', 'skipped') and "automation_events"."completed_at" is null));
--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_claim_state_check" CHECK (("automation_events"."status" = 'processing' and "automation_events"."claimed_at" is not null and "automation_events"."claim_token" is not null) or ("automation_events"."status" <> 'processing' and "automation_events"."claimed_at" is null and "automation_events"."claim_token" is null));
