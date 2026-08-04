CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"parent_token_id" uuid,
	"replaced_by_token_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(100),
	"created_ip" varchar(50),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_expiry_check" CHECK ("refresh_tokens"."expires_at" > "refresh_tokens"."created_at"),
	CONSTRAINT "refresh_tokens_parent_not_self_check" CHECK ("refresh_tokens"."parent_token_id" is null or "refresh_tokens"."parent_token_id" <> "refresh_tokens"."id"),
	CONSTRAINT "refresh_tokens_replacement_check" CHECK (("refresh_tokens"."replaced_by_token_id" is null) or ("refresh_tokens"."used_at" is not null and "refresh_tokens"."replaced_by_token_id" <> "refresh_tokens"."id")),
	CONSTRAINT "refresh_tokens_revocation_check" CHECK (("refresh_tokens"."revoked_at" is null and "refresh_tokens"."revoke_reason" is null) or ("refresh_tokens"."revoked_at" is not null and "refresh_tokens"."revoke_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_user_id_users_id_fk";
--> statement-breakpoint
UPDATE "user_sessions" SET "is_current" = false WHERE "is_current" IS NULL;
--> statement-breakpoint
ALTER TABLE "user_sessions" ALTER COLUMN "is_current" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "last_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "revoke_reason" varchar(100);--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_user_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_parent_token_id_refresh_tokens_id_fk" FOREIGN KEY ("parent_token_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_refresh_tokens_id_fk" FOREIGN KEY ("replaced_by_token_id") REFERENCES "public"."refresh_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_active_idx" ON "refresh_tokens" USING btree ("session_id","revoked_at","used_at","expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_active_idx" ON "refresh_tokens" USING btree ("family_id","revoked_at","created_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_created_idx" ON "refresh_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_sessions_user_active_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at","last_active");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_expiry_check" CHECK ("user_sessions"."expires_at" > "user_sessions"."created_at");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_revocation_check" CHECK (("user_sessions"."revoked_at" is null and "user_sessions"."revoke_reason" is null) or ("user_sessions"."revoked_at" is not null and "user_sessions"."revoke_reason" is not null));
--> statement-breakpoint
CREATE FUNCTION "validate_refresh_token_scope"() RETURNS trigger AS $$
DECLARE
  token_session record;
  parent_token record;
BEGIN
  SELECT "user_id", "expires_at", "revoked_at"
  INTO token_session
  FROM "user_sessions"
  WHERE "id" = NEW."session_id";

  IF token_session."user_id" IS NULL
    OR token_session."user_id" <> NEW."user_id"
    OR NEW."family_id" <> NEW."session_id" THEN
    RAISE EXCEPTION 'Refresh token does not belong to its user and session family';
  END IF;

  IF NEW."revoked_at" IS NULL AND (
    token_session."revoked_at" IS NOT NULL
    OR token_session."expires_at" <= now()
    OR NEW."expires_at" > token_session."expires_at"
  ) THEN
    RAISE EXCEPTION 'Active refresh token cannot outlive an active session';
  END IF;

  IF NEW."parent_token_id" IS NOT NULL THEN
    SELECT "session_id", "user_id", "family_id"
    INTO parent_token
    FROM "refresh_tokens"
    WHERE "id" = NEW."parent_token_id";
    IF parent_token."session_id" IS NULL
      OR parent_token."session_id" <> NEW."session_id"
      OR parent_token."user_id" <> NEW."user_id"
      OR parent_token."family_id" <> NEW."family_id" THEN
      RAISE EXCEPTION 'Refresh token parent does not belong to the same family';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."token_hash" <> NEW."token_hash"
      OR OLD."session_id" <> NEW."session_id"
      OR OLD."user_id" <> NEW."user_id"
      OR OLD."family_id" <> NEW."family_id"
      OR OLD."parent_token_id" IS DISTINCT FROM NEW."parent_token_id" THEN
      RAISE EXCEPTION 'Refresh token identity is immutable';
    END IF;
    IF OLD."used_at" IS NOT NULL AND OLD."used_at" IS DISTINCT FROM NEW."used_at" THEN
      RAISE EXCEPTION 'Refresh token use cannot be undone or changed';
    END IF;
    IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
      RAISE EXCEPTION 'Refresh token revocation cannot be undone';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "refresh_tokens_validate"
BEFORE INSERT OR UPDATE ON "refresh_tokens"
FOR EACH ROW EXECUTE FUNCTION "validate_refresh_token_scope"();
--> statement-breakpoint
CREATE FUNCTION "protect_and_revoke_user_session"() RETURNS trigger AS $$
BEGIN
  IF OLD."user_id" <> NEW."user_id" THEN
    RAISE EXCEPTION 'User session owner is immutable';
  END IF;
  IF NEW."expires_at" > OLD."expires_at" THEN
    RAISE EXCEPTION 'User session absolute expiry cannot be extended';
  END IF;
  IF OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'User session revocation cannot be undone';
  END IF;

  IF NEW."revoked_at" IS NOT NULL AND OLD."revoked_at" IS NULL THEN
    UPDATE "refresh_tokens"
    SET "revoked_at" = NEW."revoked_at", "revoke_reason" = NEW."revoke_reason"
    WHERE "session_id" = NEW."id" AND "revoked_at" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "user_sessions_protect_and_revoke_tokens"
BEFORE UPDATE ON "user_sessions"
FOR EACH ROW EXECUTE FUNCTION "protect_and_revoke_user_session"();
