CREATE TYPE "public"."mfa_status" AS ENUM('pending', 'enabled');--> statement-breakpoint
ALTER TYPE "public"."auth_token_purpose" ADD VALUE 'mfa_login';--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_recovery_codes_hash_check" CHECK ("mfa_recovery_codes"."code_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "user_mfa_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" "mfa_status" DEFAULT 'pending' NOT NULL,
	"encrypted_totp_secret" text NOT NULL,
	"initialization_vector" varchar(24) NOT NULL,
	"authentication_tag" varchar(24) NOT NULL,
	"encryption_algorithm" varchar(20) DEFAULT 'aes-256-gcm' NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"last_used_step" integer,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_factors_cipher_check" CHECK ("user_mfa_factors"."encryption_algorithm" = 'aes-256-gcm'),
	CONSTRAINT "user_mfa_factors_key_version_check" CHECK ("user_mfa_factors"."encryption_key_version" > 0),
	CONSTRAINT "user_mfa_factors_state_check" CHECK (("user_mfa_factors"."status" = 'pending' and "user_mfa_factors"."enabled_at" is null) or ("user_mfa_factors"."status" = 'enabled' and "user_mfa_factors"."enabled_at" is not null)),
	CONSTRAINT "user_mfa_factors_last_step_check" CHECK ("user_mfa_factors"."last_used_step" is null or "user_mfa_factors"."last_used_step" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_codes_user_hash_unique" ON "mfa_recovery_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_user_unused_idx" ON "mfa_recovery_codes" USING btree ("user_id","used_at");--> statement-breakpoint
CREATE INDEX "user_mfa_factors_status_idx" ON "user_mfa_factors" USING btree ("status");