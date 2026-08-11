DROP INDEX "sprint_analytics_events_sprint_idx";--> statement-breakpoint
DROP INDEX "sprint_analytics_events_project_idx";--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD COLUMN "event_sequence" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "sprint_analytics_events_event_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "sprint_analytics_events_sprint_idx" ON "sprint_analytics_events" USING btree ("sprint_id","occurred_at","event_sequence");--> statement-breakpoint
CREATE INDEX "sprint_analytics_events_project_idx" ON "sprint_analytics_events" USING btree ("project_id","occurred_at","event_sequence");--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_event_sequence_unique" UNIQUE("event_sequence");