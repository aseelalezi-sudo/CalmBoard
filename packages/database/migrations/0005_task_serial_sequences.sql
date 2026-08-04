CREATE TABLE "task_serial_sequences" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1041 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_serial_sequences_next_value_check" CHECK ("task_serial_sequences"."next_value" >= 1041)
);
--> statement-breakpoint
ALTER TABLE "task_serial_sequences" ADD CONSTRAINT "task_serial_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tasks"
    WHERE "serial" ~ '^TASK-[0-9]+$'
      AND substring("serial" FROM 6)::numeric >= 2147483647
  ) THEN
    RAISE EXCEPTION 'Existing task serial exceeds the supported per-organization sequence range';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "task_serial_sequences" ("organization_id", "next_value", "updated_at")
SELECT
  organization."id",
  greatest(
    1041,
    coalesce(
      max(substring(task."serial" FROM 6)::integer) FILTER (WHERE task."serial" ~ '^TASK-[0-9]+$'),
      1040
    ) + 1
  ),
  now()
FROM "organizations" organization
LEFT JOIN "tasks" task ON task."organization_id" = organization."id"
GROUP BY organization."id";
