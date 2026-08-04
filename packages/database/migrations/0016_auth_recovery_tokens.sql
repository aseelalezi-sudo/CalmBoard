CREATE TYPE "public"."auth_token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_expiry_check" CHECK ("auth_tokens"."expires_at" > "auth_tokens"."created_at"),
	CONSTRAINT "auth_tokens_terminal_state_check" CHECK (not ("auth_tokens"."consumed_at" is not null and "auth_tokens"."invalidated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_user_purpose_active_unique" ON "auth_tokens" USING btree ("user_id","purpose") WHERE "auth_tokens"."consumed_at" is null and "auth_tokens"."invalidated_at" is null;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_created_idx" ON "auth_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE FUNCTION "protect_auth_token_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."user_id" <> OLD."user_id"
    OR NEW."purpose" <> OLD."purpose"
    OR NEW."token_hash" <> OLD."token_hash"
    OR NEW."expires_at" <> OLD."expires_at"
    OR NEW."created_at" <> OLD."created_at"
    OR NEW."requested_ip" IS DISTINCT FROM OLD."requested_ip" THEN
    RAISE EXCEPTION 'Authentication token identity and expiry are immutable';
  END IF;
  IF OLD."consumed_at" IS NOT NULL AND NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at" THEN
    RAISE EXCEPTION 'Consumed authentication token cannot be changed';
  END IF;
  IF OLD."invalidated_at" IS NOT NULL AND NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at" THEN
    RAISE EXCEPTION 'Invalidated authentication token cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "auth_tokens_protect_lifecycle"
BEFORE UPDATE ON "auth_tokens"
FOR EACH ROW EXECUTE FUNCTION "protect_auth_token_lifecycle"();
