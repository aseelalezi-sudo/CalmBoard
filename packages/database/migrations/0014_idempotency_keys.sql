CREATE TYPE "public"."idempotency_key_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"actor_id" uuid,
	"key" varchar(255) NOT NULL,
	"scope" varchar(160) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" "idempotency_key_status" DEFAULT 'processing' NOT NULL,
	"lock_token" uuid NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"response_status_code" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_key_check" CHECK (length("idempotency_keys"."key") between 8 and 255),
	CONSTRAINT "idempotency_keys_scope_check" CHECK ("idempotency_keys"."scope" ~ '^[a-z0-9][a-z0-9_.:-]{1,159}$'),
	CONSTRAINT "idempotency_keys_request_hash_check" CHECK ("idempotency_keys"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "idempotency_keys_attempts_check" CHECK ("idempotency_keys"."attempts" > 0),
	CONSTRAINT "idempotency_keys_expiry_check" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at"),
	CONSTRAINT "idempotency_keys_response_status_check" CHECK ("idempotency_keys"."response_status_code" is null or "idempotency_keys"."response_status_code" between 100 and 599),
	CONSTRAINT "idempotency_keys_state_check" CHECK (("idempotency_keys"."status" = 'completed' and "idempotency_keys"."completed_at" is not null and "idempotency_keys"."response_status_code" is not null) or ("idempotency_keys"."status" <> 'completed' and "idempotency_keys"."completed_at" is null and "idempotency_keys"."response_status_code" is null and "idempotency_keys"."response_body" is null))
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_organization_scope_key_unique" ON "idempotency_keys" USING btree ("organization_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_processing_idx" ON "idempotency_keys" USING btree ("status","locked_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_idempotency_key_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."workspace_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "workspaces"
		WHERE "id" = NEW."workspace_id" AND "organization_id" = NEW."organization_id" AND "deleted_at" IS NULL
	) THEN
		RAISE EXCEPTION 'Idempotency key workspace does not belong to its organization';
	END IF;
	IF TG_OP = 'INSERT' AND NEW."actor_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "memberships"
		WHERE "user_id" = NEW."actor_id"
		AND "organization_id" = NEW."organization_id"
		AND "status" = 'active'
		AND (
			(NEW."workspace_id" IS NULL AND "workspace_id" IS NULL)
			OR (NEW."workspace_id" IS NOT NULL AND ("workspace_id" IS NULL OR "workspace_id" = NEW."workspace_id"))
		)
	) THEN
		RAISE EXCEPTION 'Idempotency key actor is not active in its tenant scope';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW."organization_id" <> OLD."organization_id"
			OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
			OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
			OR NEW."key" <> OLD."key"
			OR NEW."scope" <> OLD."scope"
			OR NEW."created_at" <> OLD."created_at" THEN
			RAISE EXCEPTION 'Idempotency key identity is immutable';
		END IF;
		IF OLD."status" = 'completed' AND NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'A completed idempotency result is immutable';
		END IF;
		IF NEW."attempts" < OLD."attempts" THEN
			RAISE EXCEPTION 'Idempotency attempts cannot decrease';
		END IF;
	END IF;
	NEW."updated_at" := now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "idempotency_keys_validate_scope"
BEFORE INSERT OR UPDATE ON "idempotency_keys"
FOR EACH ROW EXECUTE FUNCTION validate_idempotency_key_scope();
