import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const apis = pgTable(
  "apis",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull().default("GET"),
    price: text("price").notNull(),
    asset: text("asset").notNull().default("USDC"),
    network: text("network").notNull().default("stellar:testnet"),
    payTo: text("pay_to").notNull(),
    ownerId: text("owner_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index("apis_owner_id_idx").on(table.ownerId),
    activeIdx: index("apis_active_idx").on(table.active),
  })
);

export const apiCalls = pgTable(
  "api_calls",
  {
    id: serial("id").primaryKey(),
    apiId: integer("api_id")
      .notNull()
      .references(() => apis.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code"),
    charged: boolean("charged").notNull().default(false),
    amount: text("amount"),
    asset: text("asset"),
    payer: text("payer"),
    txHash: text("tx_hash"),
    settlementTx: text("settlement_tx"),
    latencyMs: integer("latency_ms"),
    requestHeaders: jsonb("request_headers"),
    responseHeaders: jsonb("response_headers"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    apiIdIdx: index("api_calls_api_id_idx").on(table.apiId),
    createdAtIdx: index("api_calls_created_at_idx").on(table.createdAt),
    chargedIdx: index("api_calls_charged_idx").on(table.charged),
    settlementTxIdx: index("api_calls_settlement_tx_idx").on(
      table.settlementTx
    ),
  })
);

export const apiStats = pgTable(
  "api_stats",
  {
    id: serial("id").primaryKey(),
    apiId: integer("api_id")
      .notNull()
      .references(() => apis.id, { onDelete: "cascade" }),
    totalCalls: integer("total_calls").notNull().default(0),
    chargedCalls: integer("charged_calls").notNull().default(0),
    totalRevenue: text("total_revenue").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    apiIdUnique: uniqueIndex("api_stats_api_id_unique").on(table.apiId),
  })
);

export type Api = typeof apis.$inferSelect;
export type NewApi = typeof apis.$inferInsert;
export type ApiCall = typeof apiCalls.$inferSelect;
export type NewApiCall = typeof apiCalls.$inferInsert;
export type ApiStat = typeof apiStats.$inferSelect;
export type NewApiStat = typeof apiStats.$inferInsert;