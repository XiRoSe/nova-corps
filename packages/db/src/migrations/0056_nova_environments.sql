CREATE TABLE IF NOT EXISTS "nova_environments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "railway_service_id" text,
  "railway_service_name" text,
  "railway_url" text,
  "status" text DEFAULT 'provisioning' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb,
  "whatsapp_number" text,
  "telegram_id" text,
  "slack_workspace" text,
  "discord_guild" text,
  "gmail_email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_environments_user_id_idx" ON "nova_environments" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nova_usage_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "env_id" uuid REFERENCES "nova_environments"("id"),
  "type" text NOT NULL,
  "amount" text DEFAULT '0' NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_usage_user_id_idx" ON "nova_usage_records" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_usage_env_id_idx" ON "nova_usage_records" USING btree ("env_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nova_usage_created_at_idx" ON "nova_usage_records" USING btree ("created_at");
