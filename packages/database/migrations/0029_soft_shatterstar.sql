CREATE TABLE "auth_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_token_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"encrypted_payload" text NOT NULL,
	"initialization_vector" varchar(24) NOT NULL,
	"authentication_tag" varchar(24) NOT NULL,
	"encryption_algorithm" varchar(20) DEFAULT 'aes-256-gcm' NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"status" "notification_email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(255),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_email_outbox_purpose_check" CHECK ("auth_email_outbox"."purpose" <> 'mfa_login'),
	CONSTRAINT "auth_email_outbox_cipher_check" CHECK ("auth_email_outbox"."encryption_algorithm" = 'aes-256-gcm'),
	CONSTRAINT "auth_email_outbox_key_version_check" CHECK ("auth_email_outbox"."encryption_key_version" > 0),
	CONSTRAINT "auth_email_outbox_attempts_check" CHECK ("auth_email_outbox"."attempts" >= 0 and "auth_email_outbox"."max_attempts" > 0),
	CONSTRAINT "auth_email_outbox_terminal_state_check" CHECK (("auth_email_outbox"."status" = 'sent' and "auth_email_outbox"."sent_at" is not null) or ("auth_email_outbox"."status" <> 'sent' and "auth_email_outbox"."sent_at" is null)),
	CONSTRAINT "auth_email_outbox_claim_state_check" CHECK (("auth_email_outbox"."status" = 'processing' and "auth_email_outbox"."claimed_at" is not null and "auth_email_outbox"."claim_token" is not null) or ("auth_email_outbox"."status" <> 'processing' and "auth_email_outbox"."claimed_at" is null and "auth_email_outbox"."claim_token" is null))
);
--> statement-breakpoint
ALTER TABLE "auth_email_outbox" ADD CONSTRAINT "auth_email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_email_outbox" ADD CONSTRAINT "auth_email_outbox_auth_token_id_auth_tokens_id_fk" FOREIGN KEY ("auth_token_id") REFERENCES "public"."auth_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_email_outbox_auth_token_unique" ON "auth_email_outbox" USING btree ("auth_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_email_outbox_idempotency_unique" ON "auth_email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "auth_email_outbox_due_idx" ON "auth_email_outbox" USING btree ("status","available_at","claimed_at");
--> statement-breakpoint
CREATE FUNCTION "validate_auth_email_outbox"() RETURNS trigger AS $$
DECLARE
  linked_token record;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."user_id" <> OLD."user_id"
    OR NEW."auth_token_id" <> OLD."auth_token_id"
    OR NEW."purpose" <> OLD."purpose"
    OR NEW."encrypted_payload" <> OLD."encrypted_payload"
    OR NEW."initialization_vector" <> OLD."initialization_vector"
    OR NEW."authentication_tag" <> OLD."authentication_tag"
    OR NEW."encryption_algorithm" <> OLD."encryption_algorithm"
    OR NEW."encryption_key_version" <> OLD."encryption_key_version"
    OR NEW."idempotency_key" <> OLD."idempotency_key"
    OR NEW."max_attempts" <> OLD."max_attempts"
  ) THEN
    RAISE EXCEPTION 'Authentication email delivery identity and encrypted payload are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'Authentication email attempts cannot decrease';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('sent', 'skipped', 'dead')
    AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'Terminal authentication email delivery cannot be reopened';
  END IF;

  SELECT "user_id", "purpose", "consumed_at", "invalidated_at", "expires_at"
  INTO linked_token
  FROM "auth_tokens"
  WHERE "id" = NEW."auth_token_id";

  IF linked_token."user_id" IS NULL
    OR linked_token."user_id" <> NEW."user_id"
    OR linked_token."purpose" <> NEW."purpose" THEN
    RAISE EXCEPTION 'Authentication email does not match its linked token';
  END IF;

  IF TG_OP = 'INSERT' AND (
    linked_token."consumed_at" IS NOT NULL
    OR linked_token."invalidated_at" IS NOT NULL
    OR linked_token."expires_at" <= now()
  ) THEN
    RAISE EXCEPTION 'Authentication email requires an active token';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "auth_email_outbox_validate"
BEFORE INSERT OR UPDATE ON "auth_email_outbox"
FOR EACH ROW EXECUTE FUNCTION "validate_auth_email_outbox"();
