CREATE TYPE "public"."integration_auth_type" AS ENUM('oauth2', 'api_key', 'bearer', 'basic', 'webhook_secret');--> statement-breakpoint
CREATE TYPE "public"."integration_credential_status" AS ENUM('active', 'expired', 'error', 'revoked');--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"credential_key" varchar(80) DEFAULT 'default' NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"auth_type" "integration_auth_type" NOT NULL,
	"encrypted_payload" text NOT NULL,
	"initialization_vector" varchar(24) NOT NULL,
	"authentication_tag" varchar(24) NOT NULL,
	"encryption_algorithm" varchar(20) DEFAULT 'aes-256-gcm' NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"secret_fingerprint" varchar(64) NOT NULL,
	"external_account_id" varchar(255),
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_credential_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_credentials_provider_check" CHECK ("integration_credentials"."provider" ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
	CONSTRAINT "integration_credentials_key_check" CHECK ("integration_credentials"."credential_key" ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
	CONSTRAINT "integration_credentials_cipher_check" CHECK ("integration_credentials"."encryption_algorithm" = 'aes-256-gcm'),
	CONSTRAINT "integration_credentials_key_version_check" CHECK ("integration_credentials"."encryption_key_version" > 0),
	CONSTRAINT "integration_credentials_payload_check" CHECK (length("integration_credentials"."encrypted_payload") > 0),
	CONSTRAINT "integration_credentials_revocation_check" CHECK (("integration_credentials"."status" = 'revoked' and "integration_credentials"."revoked_at" is not null) or ("integration_credentials"."status" <> 'revoked' and "integration_credentials"."revoked_at" is null))
);
--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_tenant_provider_key_active_unique" ON "integration_credentials" USING btree ("organization_id","workspace_id","provider","credential_key") WHERE "integration_credentials"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "integration_credentials_tenant_status_idx" ON "integration_credentials" USING btree ("organization_id","workspace_id","status","provider");--> statement-breakpoint
CREATE INDEX "integration_credentials_expiry_idx" ON "integration_credentials" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_integration_credential_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "workspaces"
		WHERE "id" = NEW."workspace_id" AND "organization_id" = NEW."organization_id" AND "deleted_at" IS NULL
	) THEN
		RAISE EXCEPTION 'Integration credential workspace does not belong to its organization';
	END IF;
	IF TG_OP = 'INSERT' AND NOT EXISTS (
		SELECT 1 FROM "memberships"
		WHERE "user_id" = NEW."created_by"
		AND "organization_id" = NEW."organization_id"
		AND "status" = 'active'
		AND "role" IN ('owner', 'admin')
		AND ("workspace_id" IS NULL OR "workspace_id" = NEW."workspace_id")
	) THEN
		RAISE EXCEPTION 'Integration credentials require an active owner or admin membership';
	END IF;
	IF NEW."status" = 'active' AND NEW."expires_at" IS NOT NULL AND NEW."expires_at" <= now() THEN
		RAISE EXCEPTION 'An active integration credential cannot already be expired';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW."organization_id" <> OLD."organization_id"
			OR NEW."workspace_id" <> OLD."workspace_id"
			OR NEW."provider" <> OLD."provider"
			OR NEW."credential_key" <> OLD."credential_key"
			OR NEW."auth_type" <> OLD."auth_type"
			OR NEW."created_by" <> OLD."created_by"
			OR NEW."created_at" <> OLD."created_at" THEN
			RAISE EXCEPTION 'Integration credential identity is immutable';
		END IF;
		IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
			RAISE EXCEPTION 'A revoked integration credential cannot be restored or rewritten';
		END IF;
		IF NEW."encrypted_payload" IS DISTINCT FROM OLD."encrypted_payload" THEN
			IF NEW."initialization_vector" = OLD."initialization_vector"
				OR NEW."authentication_tag" = OLD."authentication_tag"
				OR NEW."last_rotated_at" <= OLD."last_rotated_at" THEN
				RAISE EXCEPTION 'Credential rotation must replace the complete encryption envelope';
			END IF;
		ELSIF NEW."initialization_vector" IS DISTINCT FROM OLD."initialization_vector"
			OR NEW."authentication_tag" IS DISTINCT FROM OLD."authentication_tag"
			OR NEW."encryption_key_version" IS DISTINCT FROM OLD."encryption_key_version"
			OR NEW."secret_fingerprint" IS DISTINCT FROM OLD."secret_fingerprint" THEN
			RAISE EXCEPTION 'Encryption envelope fields cannot change without credential rotation';
		END IF;
	END IF;
	NEW."updated_at" := now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "integration_credentials_validate_tenant"
BEFORE INSERT OR UPDATE ON "integration_credentials"
FOR EACH ROW EXECUTE FUNCTION validate_integration_credential_tenant();
