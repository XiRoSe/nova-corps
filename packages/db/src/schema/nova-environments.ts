import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Per-user Nova agent environments deployed on Railway.
 * Each user gets one agent environment running the NanoClaw-based Nova agent.
 */
export const novaEnvironments = pgTable(
  "nova_environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    railwayServiceId: text("railway_service_id"),
    railwayServiceName: text("railway_service_name"),
    railwayUrl: text("railway_url"),
    status: text("status").notNull().default("provisioning"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    // Channel connection metadata
    whatsappNumber: text("whatsapp_number"),
    telegramId: text("telegram_id"),
    slackWorkspace: text("slack_workspace"),
    discordGuild: text("discord_guild"),
    gmailEmail: text("gmail_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("nova_environments_user_id_idx").on(table.userId),
  }),
);

/**
 * Usage/cost records for all channels — persists even when channels disconnect.
 * type: 'claude' = web chat exchange, 'message' = cross-channel messages
 */
export const novaUsageRecords = pgTable(
  "nova_usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    envId: uuid("env_id").references(() => novaEnvironments.id),
    type: text("type").notNull(), // 'claude' | 'message'
    amount: text("amount").notNull().default("0"), // decimal as text
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("nova_usage_user_id_idx").on(table.userId),
    envIdIdx: index("nova_usage_env_id_idx").on(table.envId),
    createdAtIdx: index("nova_usage_created_at_idx").on(table.createdAt),
  }),
);
