import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const ephemeroiSettingsTable = pgTable("ephemeroi_settings", {
  id: serial("id").primaryKey(),
  intervalSeconds: integer("interval_seconds").notNull().default(300),
  importanceThreshold: doublePrecision("importance_threshold")
    .notNull()
    .default(0.55),
  paused: boolean("paused").notNull().default(false),
  telegramEnabled: boolean("telegram_enabled").notNull().default(true),
  noveltyWeight: doublePrecision("novelty_weight").notNull().default(0.5),
  noveltyDecay: doublePrecision("novelty_decay").notNull().default(0.1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ephemeroiSourcesTable = pgTable(
  "ephemeroi_sources",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    target: text("target").notNull(),
    active: boolean("active").notNull().default(true),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastError: text("last_error"),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindTargetIdx: uniqueIndex("ephemeroi_sources_kind_target_uq").on(
      t.kind,
      t.target,
    ),
  }),
);

export const ephemeroiObservationsTable = pgTable(
  "ephemeroi_observations",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id"),
    sourceKind: text("source_kind").notNull(),
    sourceLabel: text("source_label").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet").notNull(),
    url: text("url"),
    urlHash: text("url_hash"),
    embedding: jsonb("embedding").$type<number[]>(),
    novelty: doublePrecision("novelty").notNull().default(0),
    importance: doublePrecision("importance").notNull().default(-1),
    reflected: boolean("reflected").notNull().default(false),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reflectedAt: timestamp("reflected_at", { withTimezone: true }),
  },
  (t) => ({
    urlHashIdx: uniqueIndex("ephemeroi_observations_url_hash_uq").on(
      t.urlHash,
    ),
    observedAtIdx: index("ephemeroi_observations_observed_at_idx").on(
      t.observedAt,
    ),
    reflectedIdx: index("ephemeroi_observations_reflected_idx").on(
      t.reflected,
    ),
  }),
);

export const ephemeroiBeliefsTable = pgTable("ephemeroi_beliefs", {
  id: serial("id").primaryKey(),
  proposition: text("proposition").notNull(),
  confidence: doublePrecision("confidence").notNull().default(0),
  supportCount: integer("support_count").notNull().default(0),
  contradictCount: integer("contradict_count").notNull().default(0),
  embedding: jsonb("embedding").$type<number[]>(),
  originSourceId: integer("origin_source_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ephemeroiContradictionsTable = pgTable(
  "ephemeroi_contradictions",
  {
    id: serial("id").primaryKey(),
    beliefId: integer("belief_id"),
    observationId: integer("observation_id"),
    summary: text("summary").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    resolvedIdx: index("ephemeroi_contradictions_resolved_idx").on(
      t.resolved,
    ),
  }),
);

export const ephemeroiReportsTable = pgTable(
  "ephemeroi_reports",
  {
    id: serial("id").primaryKey(),
    importance: doublePrecision("importance").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    observationIds: jsonb("observation_ids").$type<number[]>().notNull(),
    delivered: boolean("delivered").notNull().default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("ephemeroi_reports_created_at_idx").on(t.createdAt),
  }),
);
