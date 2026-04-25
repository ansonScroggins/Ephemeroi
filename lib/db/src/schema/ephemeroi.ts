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
  // Autonomy: when enabled, after each cycle's reflection step the bot
  // scans observations for GitHub references and may add a new source on
  // its own. Off by default; capped on both per-cycle and total auto-added.
  autonomyEnabled: boolean("autonomy_enabled").notNull().default(false),
  autonomyMaxSources: integer("autonomy_max_sources").notNull().default(50),
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
    // True when the source was added autonomously by Ephemeroi during a
    // cycle's discovery pass (vs. added explicitly by the user). The reason
    // is a short LLM-supplied justification we surface in the UI.
    autoAdded: boolean("auto_added").notNull().default(false),
    autoAddedReason: text("auto_added_reason"),
    autoAddedAt: timestamp("auto_added_at", { withTimezone: true }),
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

/**
 * Per-source 4D state vector — Capability, Integrity, Usability, Trust —
 * each in [0,1]. Reflection emits a `stateDelta` per event when the
 * observation actually moves the source's standing in those dimensions; the
 * loop applies the delta (clamped) and stamps the moving event + the
 * one-line "insight" extracted by the reflector. One row per source; we
 * upsert in place rather than append so reads are cheap. Time-series
 * history can be layered on later if we want sparklines.
 */
export const ephemeroiSourceStateTable = pgTable(
  "ephemeroi_source_state",
  {
    id: serial("id").primaryKey(),
    // FK-less integer to match the project convention (deleting a source
    // doesn't cascade-delete its history).
    sourceId: integer("source_id").notNull(),
    capability: doublePrecision("capability").notNull().default(0.7),
    integrity: doublePrecision("integrity").notNull().default(0.7),
    usability: doublePrecision("usability").notNull().default(0.7),
    trust: doublePrecision("trust").notNull().default(0.7),
    lastDeltaCapability: doublePrecision("last_delta_capability")
      .notNull()
      .default(0),
    lastDeltaIntegrity: doublePrecision("last_delta_integrity")
      .notNull()
      .default(0),
    lastDeltaUsability: doublePrecision("last_delta_usability")
      .notNull()
      .default(0),
    lastDeltaTrust: doublePrecision("last_delta_trust").notNull().default(0),
    lastEventObservationId: integer("last_event_observation_id"),
    lastInsight: text("last_insight"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sourceIdUq: uniqueIndex("ephemeroi_source_state_source_id_uq").on(
      t.sourceId,
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
