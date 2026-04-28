import {
  db,
  ephemeroiSettingsTable,
  ephemeroiSourcesTable,
  ephemeroiObservationsTable,
  ephemeroiBeliefsTable,
  ephemeroiContradictionsTable,
  ephemeroiReportsTable,
  ephemeroiSourceStateTable,
  ephemeroiTopicBeliefsTable,
} from "@workspace/db";
import { eq, desc, asc, and, gte, sql } from "drizzle-orm";

// ===== Settings (singleton) =====

export interface SettingsRow {
  id: number;
  intervalSeconds: number;
  importanceThreshold: number;
  paused: boolean;
  telegramEnabled: boolean;
  noveltyWeight: number;
  noveltyDecay: number;
  autonomyEnabled: boolean;
  autonomyMaxSources: number;
}

export async function getSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(ephemeroiSettingsTable)
    .orderBy(asc(ephemeroiSettingsTable.id))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0]!;
    return {
      id: row.id,
      intervalSeconds: row.intervalSeconds,
      importanceThreshold: row.importanceThreshold,
      paused: row.paused,
      telegramEnabled: row.telegramEnabled,
      noveltyWeight: row.noveltyWeight,
      noveltyDecay: row.noveltyDecay,
      autonomyEnabled: row.autonomyEnabled,
      autonomyMaxSources: row.autonomyMaxSources,
    };
  }
  // Race-safe singleton bootstrap: insert a default row, then re-read the
  // canonical lowest-id row so concurrent first-callers all converge to the
  // same SettingsRow even if multiple inserts succeed.
  await db.insert(ephemeroiSettingsTable).values({}).returning({
    id: ephemeroiSettingsTable.id,
  });
  const reread = await db
    .select()
    .from(ephemeroiSettingsTable)
    .orderBy(asc(ephemeroiSettingsTable.id))
    .limit(1);
  if (reread.length === 0) {
    throw new Error("ephemeroi_settings missing immediately after insert");
  }
  const row = reread[0]!;
  return {
    id: row.id,
    intervalSeconds: row.intervalSeconds,
    importanceThreshold: row.importanceThreshold,
    paused: row.paused,
    telegramEnabled: row.telegramEnabled,
    noveltyWeight: row.noveltyWeight,
    noveltyDecay: row.noveltyDecay,
    autonomyEnabled: row.autonomyEnabled,
    autonomyMaxSources: row.autonomyMaxSources,
  };
}

export async function updateSettings(
  patch: Partial<{
    intervalSeconds: number;
    importanceThreshold: number;
    paused: boolean;
    telegramEnabled: boolean;
    noveltyWeight: number;
    noveltyDecay: number;
    autonomyEnabled: boolean;
    autonomyMaxSources: number;
  }>,
): Promise<SettingsRow> {
  const current = await getSettings();
  const next: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.intervalSeconds !== undefined)
    next["intervalSeconds"] = patch.intervalSeconds;
  if (patch.importanceThreshold !== undefined)
    next["importanceThreshold"] = patch.importanceThreshold;
  if (patch.paused !== undefined) next["paused"] = patch.paused;
  if (patch.telegramEnabled !== undefined)
    next["telegramEnabled"] = patch.telegramEnabled;
  if (patch.noveltyWeight !== undefined)
    next["noveltyWeight"] = patch.noveltyWeight;
  if (patch.noveltyDecay !== undefined)
    next["noveltyDecay"] = patch.noveltyDecay;
  if (patch.autonomyEnabled !== undefined)
    next["autonomyEnabled"] = patch.autonomyEnabled;
  if (patch.autonomyMaxSources !== undefined)
    next["autonomyMaxSources"] = patch.autonomyMaxSources;
  await db
    .update(ephemeroiSettingsTable)
    .set(next)
    .where(eq(ephemeroiSettingsTable.id, current.id));
  return getSettings();
}

// ===== Sources =====

export type SourceKind =
  | "rss"
  | "url"
  | "search"
  | "github"
  | "github_user"
  | "gh_archive";

export interface SourceRow {
  id: number;
  kind: SourceKind;
  label: string;
  target: string;
  active: boolean;
  lastPolledAt: Date | null;
  lastError: string | null;
  autoAdded: boolean;
  autoAddedReason: string | null;
  autoAddedAt: Date | null;
  createdAt: Date;
}

function rowToSource(r: typeof ephemeroiSourcesTable.$inferSelect): SourceRow {
  return {
    id: r.id,
    kind: r.kind as SourceKind,
    label: r.label,
    target: r.target,
    active: r.active,
    lastPolledAt: r.lastPolledAt,
    lastError: r.lastError,
    autoAdded: r.autoAdded,
    autoAddedReason: r.autoAddedReason,
    autoAddedAt: r.autoAddedAt,
    createdAt: r.createdAt,
  };
}

export async function listSources(): Promise<SourceRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiSourcesTable)
    .orderBy(desc(ephemeroiSourcesTable.createdAt));
  return rows.map(rowToSource);
}

export async function createSource(input: {
  kind: SourceKind;
  target: string;
  label?: string;
  autoAdded?: boolean;
  autoAddedReason?: string | null;
}): Promise<SourceRow> {
  const label = input.label?.trim() || deriveLabel(input.kind, input.target);
  const auto = input.autoAdded === true;
  const inserted = await db
    .insert(ephemeroiSourcesTable)
    .values({
      kind: input.kind,
      target: input.target,
      label,
      active: true,
      autoAdded: auto,
      autoAddedReason: auto ? (input.autoAddedReason ?? null) : null,
      autoAddedAt: auto ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return rowToSource(inserted[0]!);
  // Already existed — return existing.
  const existing = await db
    .select()
    .from(ephemeroiSourcesTable)
    .where(
      and(
        eq(ephemeroiSourcesTable.kind, input.kind),
        eq(ephemeroiSourcesTable.target, input.target),
      ),
    )
    .limit(1);
  return rowToSource(existing[0]!);
}

export async function deleteSource(id: number): Promise<boolean> {
  const deleted = await db
    .delete(ephemeroiSourcesTable)
    .where(eq(ephemeroiSourcesTable.id, id))
    .returning({ id: ephemeroiSourcesTable.id });
  return deleted.length > 0;
}

export async function markSourcePolled(
  id: number,
  err: string | null,
): Promise<void> {
  await db
    .update(ephemeroiSourcesTable)
    .set({ lastPolledAt: new Date(), lastError: err })
    .where(eq(ephemeroiSourcesTable.id, id));
}

export async function getSourceCursor(
  id: number,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ cursor: ephemeroiSourcesTable.cursor })
    .from(ephemeroiSourcesTable)
    .where(eq(ephemeroiSourcesTable.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return (rows[0]!.cursor as Record<string, unknown> | null) ?? null;
}

export async function updateSourceCursor(
  id: number,
  cursor: Record<string, unknown>,
): Promise<void> {
  await db
    .update(ephemeroiSourcesTable)
    .set({ cursor })
    .where(eq(ephemeroiSourcesTable.id, id));
}

/**
 * How many sources Ephemeroi has added to itself so far. Used by the
 * discovery pass to enforce the user-configured hard cap.
 */
export async function countAutoAddedSources(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ephemeroiSourcesTable)
    .where(eq(ephemeroiSourcesTable.autoAdded, true));
  return rows[0]?.n ?? 0;
}

// ===== Source state vector (Capability/Integrity/Usability/Trust) =====

export interface SourceStateRow {
  id: number;
  sourceId: number;
  capability: number;
  integrity: number;
  usability: number;
  trust: number;
  lastDeltaCapability: number;
  lastDeltaIntegrity: number;
  lastDeltaUsability: number;
  lastDeltaTrust: number;
  lastEventObservationId: number | null;
  lastInsight: string | null;
  lastEventAt: Date | null;
  updatedAt: Date;
}

const STATE_AXIS_DEFAULT = 0.7;

function rowToSourceState(r: typeof ephemeroiSourceStateTable.$inferSelect): SourceStateRow {
  return {
    id: r.id,
    sourceId: r.sourceId,
    capability: r.capability,
    integrity: r.integrity,
    usability: r.usability,
    trust: r.trust,
    lastDeltaCapability: r.lastDeltaCapability,
    lastDeltaIntegrity: r.lastDeltaIntegrity,
    lastDeltaUsability: r.lastDeltaUsability,
    lastDeltaTrust: r.lastDeltaTrust,
    lastEventObservationId: r.lastEventObservationId,
    lastInsight: r.lastInsight,
    lastEventAt: r.lastEventAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Read the current state vector for a source. Lazily inserts a default row
 * (0.7 across the board — "neutral but tentatively trusted") on first read,
 * so callers always get a row back. Race-safe via onConflictDoNothing then
 * re-select.
 */
export async function getSourceState(
  sourceId: number,
): Promise<SourceStateRow> {
  const existing = await db
    .select()
    .from(ephemeroiSourceStateTable)
    .where(eq(ephemeroiSourceStateTable.sourceId, sourceId))
    .limit(1);
  if (existing.length > 0) return rowToSourceState(existing[0]!);
  await db
    .insert(ephemeroiSourceStateTable)
    .values({
      sourceId,
      capability: STATE_AXIS_DEFAULT,
      integrity: STATE_AXIS_DEFAULT,
      usability: STATE_AXIS_DEFAULT,
      trust: STATE_AXIS_DEFAULT,
    })
    .onConflictDoNothing();
  const reread = await db
    .select()
    .from(ephemeroiSourceStateTable)
    .where(eq(ephemeroiSourceStateTable.sourceId, sourceId))
    .limit(1);
  return rowToSourceState(reread[0]!);
}

/**
 * Apply a per-axis delta to a source's state vector, clamped to [0,1] on
 * each axis. Records the moving observation + the insight extracted by the
 * reflector so the UI / Telegram can attribute the move. Returns the new
 * state row.
 */
export async function applySourceStateDelta(input: {
  sourceId: number;
  delta: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  observationId: number;
  insight: string | null;
}): Promise<SourceStateRow> {
  // Ensure a row exists outside the tx so the FOR UPDATE lock has something
  // to grab. getSourceState is itself race-safe via onConflictDoNothing.
  await getSourceState(input.sourceId);

  return await db.transaction(async (tx) => {
    // Lock the row for the duration of the transaction so concurrent cycles
    // (timer + manual /cycle/run) cannot lose updates via a read-modify-write
    // race.
    const locked = await tx
      .select()
      .from(ephemeroiSourceStateTable)
      .where(eq(ephemeroiSourceStateTable.sourceId, input.sourceId))
      .for("update")
      .limit(1);
    const current = rowToSourceState(locked[0]!);

    const nextC = clamp(current.capability + input.delta.capability, 0, 1);
    const nextI = clamp(current.integrity + input.delta.integrity, 0, 1);
    const nextU = clamp(current.usability + input.delta.usability, 0, 1);
    const nextT = clamp(current.trust + input.delta.trust, 0, 1);

    // Record the actual applied delta (post-clamp), not the requested one,
    // so the UI shows truthful arrows even when a vector is already at the
    // edge of the [0,1] box.
    const appliedC = nextC - current.capability;
    const appliedI = nextI - current.integrity;
    const appliedU = nextU - current.usability;
    const appliedT = nextT - current.trust;

    const updated = await tx
      .update(ephemeroiSourceStateTable)
      .set({
        capability: nextC,
        integrity: nextI,
        usability: nextU,
        trust: nextT,
        lastDeltaCapability: appliedC,
        lastDeltaIntegrity: appliedI,
        lastDeltaUsability: appliedU,
        lastDeltaTrust: appliedT,
        lastEventObservationId: input.observationId,
        lastInsight: input.insight,
        lastEventAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ephemeroiSourceStateTable.sourceId, input.sourceId))
      .returning();
    return rowToSourceState(updated[0]!);
  });
}

/** All source states — used to hydrate the Sources page. */
export async function listSourceStates(): Promise<SourceStateRow[]> {
  const rows = await db.select().from(ephemeroiSourceStateTable);
  return rows.map(rowToSourceState);
}

function deriveLabel(kind: SourceKind, target: string): string {
  if (kind === "search") return `Search: ${target}`;
  if (kind === "github") return `GitHub: ${target}`;
  if (kind === "github_user") return `GitHub user: ${target}`;
  if (kind === "gh_archive") {
    const filter = target.trim() || "all events";
    return `GH Archive: ${filter.length > 60 ? filter.slice(0, 57) + "…" : filter}`;
  }
  try {
    const u = new URL(target);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return target.slice(0, 80);
  }
}

// ===== Observations =====

export interface ObservationRow {
  id: number;
  sourceId: number | null;
  sourceKind: SourceKind;
  sourceLabel: string;
  title: string;
  snippet: string;
  url: string | null;
  urlHash: string | null;
  embedding: number[] | null;
  novelty: number;
  importance: number;
  reflected: boolean;
  observedAt: Date;
  reflectedAt: Date | null;
}

function rowToObs(
  r: typeof ephemeroiObservationsTable.$inferSelect,
): ObservationRow {
  return {
    id: r.id,
    sourceId: r.sourceId,
    sourceKind: r.sourceKind as SourceKind,
    sourceLabel: r.sourceLabel,
    title: r.title,
    snippet: r.snippet,
    url: r.url,
    urlHash: r.urlHash,
    embedding: r.embedding,
    novelty: r.novelty,
    importance: r.importance,
    reflected: r.reflected,
    observedAt: r.observedAt,
    reflectedAt: r.reflectedAt,
  };
}

export async function insertObservationIfNew(input: {
  sourceId: number | null;
  sourceKind: SourceKind;
  sourceLabel: string;
  title: string;
  snippet: string;
  url: string | null;
  urlHash: string | null;
}): Promise<ObservationRow | null> {
  const inserted = await db
    .insert(ephemeroiObservationsTable)
    .values({
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      title: input.title,
      snippet: input.snippet,
      url: input.url,
      urlHash: input.urlHash,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return null;
  return rowToObs(inserted[0]!);
}

export async function listRecentObservations(
  limit: number,
): Promise<ObservationRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiObservationsTable)
    .orderBy(desc(ephemeroiObservationsTable.observedAt))
    .limit(limit);
  return rows.map(rowToObs);
}

export async function listUnreflectedObservations(
  limit: number,
): Promise<ObservationRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiObservationsTable)
    .where(eq(ephemeroiObservationsTable.reflected, false))
    .orderBy(asc(ephemeroiObservationsTable.observedAt))
    .limit(limit);
  return rows.map(rowToObs);
}

export async function setObservationEmbedding(
  id: number,
  embedding: number[],
  novelty: number,
): Promise<void> {
  await db
    .update(ephemeroiObservationsTable)
    .set({ embedding, novelty })
    .where(eq(ephemeroiObservationsTable.id, id));
}

export async function markObservationReflected(
  id: number,
  importance: number,
): Promise<void> {
  await db
    .update(ephemeroiObservationsTable)
    .set({ reflected: true, importance, reflectedAt: new Date() })
    .where(eq(ephemeroiObservationsTable.id, id));
}

export async function listEmbeddedObservationsForNovelty(
  limit: number,
): Promise<Array<{ id: number; embedding: number[] }>> {
  const rows = await db
    .select({
      id: ephemeroiObservationsTable.id,
      embedding: ephemeroiObservationsTable.embedding,
    })
    .from(ephemeroiObservationsTable)
    .orderBy(desc(ephemeroiObservationsTable.observedAt))
    .limit(limit);
  return rows
    .filter((r): r is { id: number; embedding: number[] } => !!r.embedding)
    .map((r) => ({ id: r.id, embedding: r.embedding }));
}

// ===== Beliefs =====

export interface BeliefRow {
  id: number;
  proposition: string;
  confidence: number;
  supportCount: number;
  contradictCount: number;
  embedding: number[] | null;
  originSourceId: number | null;
  firstSeenAt: Date;
  lastUpdatedAt: Date;
}

function rowToBelief(
  r: typeof ephemeroiBeliefsTable.$inferSelect,
): BeliefRow {
  return {
    id: r.id,
    proposition: r.proposition,
    confidence: r.confidence,
    supportCount: r.supportCount,
    contradictCount: r.contradictCount,
    embedding: r.embedding,
    originSourceId: r.originSourceId ?? null,
    firstSeenAt: r.firstSeenAt,
    lastUpdatedAt: r.lastUpdatedAt,
  };
}

export async function listBeliefs(): Promise<BeliefRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .orderBy(desc(ephemeroiBeliefsTable.lastUpdatedAt));
  return rows.map(rowToBelief);
}

export async function findBeliefByProposition(
  proposition: string,
): Promise<BeliefRow | null> {
  const rows = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .where(eq(ephemeroiBeliefsTable.proposition, proposition))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToBelief(rows[0]!);
}

export async function upsertBelief(input: {
  proposition: string;
  deltaConfidence: number;
  embedding?: number[] | null;
  originSourceId?: number | null;
}): Promise<BeliefRow> {
  const existing = await findBeliefByProposition(input.proposition);
  if (existing) {
    const newConfidence = clamp(
      existing.confidence + input.deltaConfidence,
      -1,
      1,
    );
    const support = input.deltaConfidence > 0 ? 1 : 0;
    const contradict = input.deltaConfidence < 0 ? 1 : 0;
    // RETURNING the updated row in the same statement avoids a separate
    // re-read that could fail with a non-null assertion crash if the user
    // (or another process) deleted/cleared the belief between the read
    // above and the read after the update. If the row vanished mid-flight,
    // we transparently fall through to insert, so a reflection cycle is
    // never killed by a concurrent "Clear belief" UI action.
    const updated = await db
      .update(ephemeroiBeliefsTable)
      .set({
        confidence: newConfidence,
        supportCount: existing.supportCount + support,
        contradictCount: existing.contradictCount + contradict,
        embedding: input.embedding ?? existing.embedding,
        originSourceId:
          existing.originSourceId ?? input.originSourceId ?? null,
        lastUpdatedAt: new Date(),
      })
      .where(eq(ephemeroiBeliefsTable.id, existing.id))
      .returning();
    if (updated.length > 0) return rowToBelief(updated[0]!);
    // Existing row was deleted between the read and the update — fall
    // through to the insert path below so the reflection still records
    // its delta as a freshly re-formed belief.
  }
  const inserted = await db
    .insert(ephemeroiBeliefsTable)
    .values({
      proposition: input.proposition,
      confidence: clamp(input.deltaConfidence, -1, 1),
      supportCount: input.deltaConfidence > 0 ? 1 : 0,
      contradictCount: input.deltaConfidence < 0 ? 1 : 0,
      embedding: input.embedding ?? null,
      originSourceId: input.originSourceId ?? null,
    })
    .returning();
  return rowToBelief(inserted[0]!);
}

/**
 * Hard-delete a belief by id. Used by the "clear" UI action when the user
 * decides a belief is no longer serving and should be wiped entirely.
 *
 * Returns true if a row was deleted, false if no belief with that id existed.
 */
export async function deleteBelief(id: number): Promise<boolean> {
  const deleted = await db
    .delete(ephemeroiBeliefsTable)
    .where(eq(ephemeroiBeliefsTable.id, id))
    .returning({ id: ephemeroiBeliefsTable.id });
  return deleted.length > 0;
}

/**
 * Soft-trim a belief: scale its confidence and support/contradict counts
 * down toward zero by `keepFraction` (0..1). Used by the "trim" UI action
 * when the user wants to preserve the proposition (so it can re-form
 * organically) but discard most of its accumulated weight.
 *
 *   keepFraction = 0.0  → equivalent to a soft reset (counts -> 0, conf -> 0)
 *   keepFraction = 0.25 → keep a quarter of the signal (the default UI option)
 *   keepFraction = 1.0  → no-op
 *
 * IMPORTANT: this uses a single SQL UPDATE with column-expression scaling
 * (rather than read-then-write) so it is safe against concurrent
 * reflection cycles touching the same belief — there is no read/compute/
 * write window where a parallel upsert could be lost. RETURNING gives us
 * the post-update row in the same statement.
 */
export async function trimBelief(
  id: number,
  keepFraction: number,
): Promise<BeliefRow | null> {
  const k = clamp(keepFraction, 0, 1);
  // Confidence is already in [-1, 1]; scaling by k ∈ [0,1] keeps it in
  // range so no GREATEST/LEAST clamp is needed. Counts are non-negative
  // integers; floor() avoids fractional rows from float multiplication.
  // Cast `k` to float8 in-SQL so Postgres doesn't try to coerce the bound
  // parameter to an int based on the surrounding integer column context
  // (which would fail with "invalid input syntax for type integer: 0.25").
  const updated = await db
    .update(ephemeroiBeliefsTable)
    .set({
      confidence: sql`${ephemeroiBeliefsTable.confidence} * (${k}::float8)`,
      supportCount: sql`floor(${ephemeroiBeliefsTable.supportCount}::float8 * (${k}::float8))::int`,
      contradictCount: sql`floor(${ephemeroiBeliefsTable.contradictCount}::float8 * (${k}::float8))::int`,
      lastUpdatedAt: new Date(),
    })
    .where(eq(ephemeroiBeliefsTable.id, id))
    .returning();
  if (updated.length === 0) return null;
  return rowToBelief(updated[0]!);
}

export async function listBeliefsBySource(
  kind: SourceKind,
  target: string,
): Promise<{
  source: SourceRow | null;
  beliefs: BeliefRow[];
  contradictions: Array<{
    id: number;
    summary: string;
    resolved: boolean;
    detectedAt: Date;
  }>;
}> {
  const sourceRows = await db
    .select()
    .from(ephemeroiSourcesTable)
    .where(
      and(
        eq(ephemeroiSourcesTable.kind, kind),
        eq(ephemeroiSourcesTable.target, target),
      ),
    )
    .limit(1);
  if (sourceRows.length === 0) {
    return { source: null, beliefs: [], contradictions: [] };
  }
  const source = rowToSource(sourceRows[0]!);

  const beliefRows = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .where(eq(ephemeroiBeliefsTable.originSourceId, source.id))
    .orderBy(desc(ephemeroiBeliefsTable.confidence));
  const beliefs = beliefRows.map(rowToBelief);

  // Contradictions tied to those beliefs (or to observations from this source).
  const obsIds = await db
    .select({ id: ephemeroiObservationsTable.id })
    .from(ephemeroiObservationsTable)
    .where(eq(ephemeroiObservationsTable.sourceId, source.id));
  const obsIdSet = new Set(obsIds.map((r) => r.id));
  const beliefIdSet = new Set(beliefs.map((b) => b.id));

  const allContradictions = await db
    .select()
    .from(ephemeroiContradictionsTable)
    .orderBy(desc(ephemeroiContradictionsTable.detectedAt));
  const contradictions = allContradictions
    .filter(
      (c) =>
        (c.beliefId !== null && beliefIdSet.has(c.beliefId)) ||
        (c.observationId !== null && obsIdSet.has(c.observationId)),
    )
    .map((c) => ({
      id: c.id,
      summary: c.summary,
      resolved: c.resolved,
      detectedAt: c.detectedAt,
    }));

  return { source, beliefs, contradictions };
}

// ===== Contradictions =====

export interface ContradictionRow {
  id: number;
  beliefId: number | null;
  beliefProposition: string | null;
  observationId: number | null;
  summary: string;
  resolved: boolean;
  detectedAt: Date;
}

export async function insertContradiction(input: {
  beliefId: number | null;
  observationId: number | null;
  summary: string;
}): Promise<ContradictionRow> {
  const inserted = await db
    .insert(ephemeroiContradictionsTable)
    .values({
      beliefId: input.beliefId,
      observationId: input.observationId,
      summary: input.summary,
    })
    .returning();
  const r = inserted[0]!;
  let beliefProposition: string | null = null;
  if (r.beliefId) {
    const b = await db
      .select({ proposition: ephemeroiBeliefsTable.proposition })
      .from(ephemeroiBeliefsTable)
      .where(eq(ephemeroiBeliefsTable.id, r.beliefId))
      .limit(1);
    if (b.length > 0) beliefProposition = b[0]!.proposition;
  }
  return {
    id: r.id,
    beliefId: r.beliefId,
    beliefProposition,
    observationId: r.observationId,
    summary: r.summary,
    resolved: r.resolved,
    detectedAt: r.detectedAt,
  };
}

export async function listContradictions(): Promise<ContradictionRow[]> {
  const rows = await db
    .select({
      id: ephemeroiContradictionsTable.id,
      beliefId: ephemeroiContradictionsTable.beliefId,
      observationId: ephemeroiContradictionsTable.observationId,
      summary: ephemeroiContradictionsTable.summary,
      resolved: ephemeroiContradictionsTable.resolved,
      detectedAt: ephemeroiContradictionsTable.detectedAt,
      beliefProposition: ephemeroiBeliefsTable.proposition,
    })
    .from(ephemeroiContradictionsTable)
    .leftJoin(
      ephemeroiBeliefsTable,
      eq(ephemeroiContradictionsTable.beliefId, ephemeroiBeliefsTable.id),
    )
    .orderBy(desc(ephemeroiContradictionsTable.detectedAt));
  return rows.map((r) => ({
    id: r.id,
    beliefId: r.beliefId,
    beliefProposition: r.beliefProposition,
    observationId: r.observationId,
    summary: r.summary,
    resolved: r.resolved,
    detectedAt: r.detectedAt,
  }));
}

// ===== Reports =====

export interface ReportRow {
  id: number;
  importance: number;
  headline: string;
  body: string;
  observationIds: number[];
  delivered: boolean;
  deliveredAt: Date | null;
  createdAt: Date;
}

function rowToReport(
  r: typeof ephemeroiReportsTable.$inferSelect,
): ReportRow {
  return {
    id: r.id,
    importance: r.importance,
    headline: r.headline,
    body: r.body,
    observationIds: r.observationIds,
    delivered: r.delivered,
    deliveredAt: r.deliveredAt,
    createdAt: r.createdAt,
  };
}

export async function insertReport(input: {
  importance: number;
  headline: string;
  body: string;
  observationIds: number[];
}): Promise<ReportRow> {
  const inserted = await db
    .insert(ephemeroiReportsTable)
    .values({
      importance: input.importance,
      headline: input.headline,
      body: input.body,
      observationIds: input.observationIds,
    })
    .returning();
  return rowToReport(inserted[0]!);
}

export async function listRecentReports(limit: number): Promise<ReportRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiReportsTable)
    .orderBy(desc(ephemeroiReportsTable.createdAt))
    .limit(limit);
  return rows.map(rowToReport);
}

export async function markReportDelivered(id: number): Promise<void> {
  await db
    .update(ephemeroiReportsTable)
    .set({ delivered: true, deliveredAt: new Date() })
    .where(eq(ephemeroiReportsTable.id, id));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ===== Topic beliefs (autonomous Q&A / PDF-driven) =====

const TOPIC_HISTORY_CAP = 10;

/**
 * Threshold on signed-confidence magnitude required to flip stance after
 * blending opposite-stance evidence with the prior. Lower = flips more
 * easily (the bot reads as flighty); higher = stance is sticky and old
 * positions hold even against contradicting evidence (the bot reads as
 * stubborn). 0.15 is a deliberate middle: a single moderate-confidence
 * contradiction CAN'T flip a strong prior, but two moderate ones in
 * quick succession CAN.
 */
const FLIP_SIGNED_THRESHOLD = 0.15;

/**
 * Reinforcement weight: when same-stance evidence arrives, the new
 * confidence climbs by `(1 - prev) * REINFORCE_WEIGHT * input_conf`. This
 * gives diminishing returns — a stance at 0.9 barely moves on more
 * agreement, while a stance at 0.4 moves substantially. Matches how
 * bayesian belief revision typically behaves.
 */
const REINFORCE_WEIGHT = 0.4;

/**
 * Default half-life for passive opinion decay, in milliseconds. Without
 * any new evidence, an opinion's confidence drifts toward neutral 0.5 at
 * this rate. Modulated by the cognitive field — see
 * `cognitiveField.decayHalfLifeMultiplier`.
 */
const DEFAULT_OPINION_HALF_LIFE_MS =
  Number(process.env["EPHEMEROI_OPINION_HALF_LIFE_MS"]) ||
  7 * 24 * 60 * 60 * 1000; // 7 days

export interface TopicBeliefRow {
  id: number;
  subject: string;
  subjectKey: string;
  stance: string;
  confidence: number;
  evidenceCount: number;
  lastEvidence: string | null;
  lastSourceKind: string | null;
  lastQuestion: string | null;
  history: Array<{
    stance: string;
    confidence: number;
    evidence?: string;
    sourceKind?: string;
    at: string;
    flip?: boolean;
    decay?: boolean;
  }>;
  flipCount: number;
  lastDriftAt: Date | null;
  firstSeenAt: Date;
  lastUpdatedAt: Date;
}

export interface TopicBeliefUpsertInput {
  subject: string;
  stance: string;
  confidence: number;
  evidence?: string;
  sourceKind?: string;
  question?: string;
}

/**
 * Slugify a subject string into a stable upsert key. Lowercase, strip
 * non-alphanumerics down to single hyphens, trim, cap length. Trivial
 * normalization on purpose — we'd rather have a few near-duplicates than
 * over-collapse distinct subjects ("openai gpt-4o" vs "openai gpt-4o-mini").
 */
export function topicSubjectKey(subject: string): string {
  return subject
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Coarse semantic alignment between two stance strings. We don't have a
 * stance taxonomy — the extractor produces freeform short sentences — so
 * the cheapest signal is "is this stance saying the same thing or the
 * opposite of what we already had?". We approximate with two heuristics:
 *
 *   1. Exact-or-substring match → +1 (clearly aligned)
 *   2. Negation-marker asymmetry → −0.6 (one says "not / never / against",
 *      the other doesn't)
 *   3. Otherwise → token Jaccard, mapped roughly to [-0.5, +1] via
 *      `2·j − 0.5` (clamped to [−1, +1]), with a small positive bias
 *      because two stances about the same subject that share substantial
 *      vocabulary are usually the same direction.
 *
 * This is intentionally crude — only the SIGN of the return value drives
 * branch selection in `upsertTopicBelief` (reinforce vs blend), and the
 * FLIP_SIGNED_THRESHOLD gate (which works on confidence, not on this
 * alignment) prevents single noisy alignments from flipping a sticky
 * stance. We clamp to [-1, +1] anyway so callers can rely on the range.
 */
export function stanceAlignment(prev: string, next: string): number {
  const a = prev.toLowerCase().trim();
  const b = next.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;

  const negPattern = /\b(not|never|no|against|reject|oppose|wrong|false|disagree|doubt|skeptic|skeptical)\b/;
  const aNeg = negPattern.test(a);
  const bNeg = negPattern.test(b);
  // XOR — exactly one side carries a negation marker → we read them as
  // opposite directions on the same subject.
  if (aNeg !== bNeg) return -0.6;

  const aTok = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  const bTok = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = aTok.size + bTok.size - inter;
  if (union === 0) return 0;
  const jaccard = inter / union;
  return clamp(2 * jaccard - 0.5, -1, 1);
}

/**
 * Upsert a topic belief by subjectKey, applying the opinion-dynamics model:
 *
 *   * **First sight** — insert with `confidence = input.confidence`,
 *     evidenceCount=1, single-entry history.
 *   * **Reinforcement** (alignment ≥ 0) — keep prior stance, climb confidence
 *     with diminishing returns: `prev + (1 − prev) · REINFORCE_WEIGHT · input.confidence`.
 *   * **Contradiction** (alignment < 0) — blend in *signed-confidence space*:
 *     `signed = prevSign · prevConf − inputConf` (the new evidence pulls in
 *     the opposite direction). The result's magnitude is the new confidence;
 *     stance flips iff the resulting sign is opposite the prior AND the
 *     magnitude clears `FLIP_SIGNED_THRESHOLD`. Sub-threshold contradictions
 *     just *erode* confidence without flipping — the bot's prior position
 *     wobbles before it falls.
 *
 * Concurrency: same as the prior implementation — `db.transaction` with
 * `SELECT ... FOR UPDATE` serializes existing-row updates, plus a one-time
 * retry on PostgreSQL `23505` to handle the lost-INSERT race.
 */
export async function upsertTopicBelief(
  input: TopicBeliefUpsertInput,
): Promise<TopicBeliefRow> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("upsertTopicBelief: empty subject");
  const subjectKey = topicSubjectKey(subject);
  if (!subjectKey) throw new Error("upsertTopicBelief: subject normalizes to empty");

  const stance = input.stance.trim();
  const confidence = clamp(input.confidence, 0, 1);
  const evidence = input.evidence?.trim() || null;
  const sourceKind = input.sourceKind?.trim() || null;
  const question = input.question?.trim() || null;
  const now = new Date();

  // Concurrency model: the Telegram pipeline fires extraction-and-upsert
  // calls in detached promises, so two answers landing close together (or a
  // typed Q&A and a PDF read) can race on the same subjectKey. We protect
  // against two failure modes:
  //   * Lost UPDATE (both writers see an existing row, both increment
  //     evidenceCount/history off the same prior view, second write
  //     overwrites first): handled by `db.transaction` + `SELECT FOR UPDATE`,
  //     which serializes the read-modify-write on the row.
  //   * Lost INSERT (both writers see "no row yet", both INSERT, the second
  //     hits the unique_violation on subjectKey): handled by retrying the
  //     whole transaction once on PostgreSQL error 23505 — the second pass
  //     finds the winner's row and takes the UPDATE branch, so neither
  //     writer's evidence/history entry is dropped.
  // One retry is enough because after the conflict the row exists, and from
  // then on every concurrent call goes through the FOR UPDATE path.
  const run = () =>
    db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(ephemeroiTopicBeliefsTable)
        .where(eq(ephemeroiTopicBeliefsTable.subjectKey, subjectKey))
        .for("update")
        .limit(1);

      if (existing.length === 0) {
        const newHistoryEntry = {
          stance,
          confidence,
          ...(evidence ? { evidence } : {}),
          ...(sourceKind ? { sourceKind } : {}),
          at: now.toISOString(),
        };
        const inserted = await tx
          .insert(ephemeroiTopicBeliefsTable)
          .values({
            subject,
            subjectKey,
            stance,
            confidence,
            evidenceCount: 1,
            lastEvidence: evidence,
            lastSourceKind: sourceKind,
            lastQuestion: question,
            history: [newHistoryEntry],
            flipCount: 0,
            firstSeenAt: now,
            lastUpdatedAt: now,
          })
          .returning();
        return rowToTopicBelief(inserted[0]!);
      }

      const prev = existing[0]!;

      // Opinion dynamics: figure out whether this new evidence is
      // reinforcing the prior stance or contradicting it, then blend.
      const alignment = stanceAlignment(prev.stance, stance);
      let nextStance = prev.stance;
      let nextConfidence: number;
      let flipped = false;

      if (alignment >= 0) {
        // Reinforcement — same direction. Climb confidence with diminishing
        // returns. The new stance text REPLACES the prior text only if the
        // new evidence is at least as confident as the prior — otherwise
        // we keep the more confident phrasing on file. (We're not voting on
        // "which sentence is prettier", we're tracking who said it harder.)
        nextConfidence = clamp(
          prev.confidence + (1 - prev.confidence) * REINFORCE_WEIGHT * confidence,
          0,
          1,
        );
        if (confidence >= prev.confidence) nextStance = stance;
      } else {
        // Contradiction — blend in 0.5-centered *signed-conviction* space so
        // the active blend agrees with the passive decay loop (which also
        // treats 0.5 as neutral). The prior's signed conviction is
        // (prev.confidence − 0.5) ∈ [−0.5, +0.5], positive = still believes
        // the prior stance. The new evidence pulls in the opposite direction
        // with strength `confidence · REINFORCE_WEIGHT` (same diminishing-
        // returns weight we use for reinforcement, so a single contradiction
        // can't catastrophically wipe out prior conviction).
        //
        // Outcomes:
        //   blendedSigned > 0  → prior survives, eroded toward neutral
        //   blendedSigned < 0  AND |blendedSigned| ≥ FLIP_SIGNED_THRESHOLD
        //                      → new stance wins, adopt it
        //   blendedSigned < 0  but sub-threshold → prior wobbles, conf
        //                      collapses toward 0.5 but stance is held
        //
        // Wire confidence is "how strongly we hold the *current* stance",
        // so it is clamped to [0.5, 1] — going below 0.5 in the same stance
        // would be incoherent (it would mean we're more confident in the
        // opposite, which is the FLIP case).
        const prevSigned = prev.confidence - 0.5;
        const blendedSigned = prevSigned - confidence * REINFORCE_WEIGHT;
        if (blendedSigned <= -FLIP_SIGNED_THRESHOLD) {
          // Decisive flip — adopt the new stance with conviction equal to
          // the magnitude that crossed the threshold (so a borderline flip
          // arrives with low confidence and a strong flip arrives strong).
          nextStance = stance;
          flipped = true;
          nextConfidence = clamp(0.5 + Math.abs(blendedSigned), 0.5, 1);
        } else {
          // No flip → prior stance is held, but contradictory evidence must
          // never INCREASE confidence in that prior. We use the positive
          // remainder of blendedSigned as the surviving conviction; a
          // sub-threshold negative blend collapses cleanly to exact
          // neutral (0.5).
          nextConfidence = clamp(0.5 + Math.max(0, blendedSigned), 0.5, 1);
        }
      }

      const newHistoryEntry = {
        stance: nextStance,
        confidence: nextConfidence,
        ...(evidence ? { evidence } : {}),
        ...(sourceKind ? { sourceKind } : {}),
        at: now.toISOString(),
        ...(flipped ? { flip: true as const } : {}),
      };
      const trimmedHistory = [newHistoryEntry, ...(prev.history ?? [])].slice(
        0,
        TOPIC_HISTORY_CAP,
      );
      const updated = await tx
        .update(ephemeroiTopicBeliefsTable)
        .set({
          // Keep the original human-readable subject text — only the stance
          // text is allowed to evolve, since "subject" is the topic identity
          // and stance is the position taken on it.
          stance: nextStance,
          confidence: nextConfidence,
          evidenceCount: prev.evidenceCount + 1,
          lastEvidence: evidence,
          lastSourceKind: sourceKind,
          lastQuestion: question,
          history: trimmedHistory,
          flipCount: prev.flipCount + (flipped ? 1 : 0),
          lastUpdatedAt: now,
        })
        .where(eq(ephemeroiTopicBeliefsTable.id, prev.id))
        .returning();
      return rowToTopicBelief(updated[0]!);
    });

  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err)) return await run();
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // node-postgres surfaces SQLSTATE on the thrown error as `code`. drizzle
  // re-throws it unwrapped, so this works for both transaction layers.
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

export async function listTopicBeliefs(limit = 100): Promise<TopicBeliefRow[]> {
  const rows = await db
    .select()
    .from(ephemeroiTopicBeliefsTable)
    .orderBy(desc(ephemeroiTopicBeliefsTable.lastUpdatedAt))
    .limit(limit);
  return rows.map(rowToTopicBelief);
}

/**
 * Apply passive decay to all topic beliefs whose confidence has drifted
 * out-of-date. For each row, confidence drifts toward neutral 0.5
 * exponentially with the configured half-life, modulated by a multiplier
 * (lets the cognitive field slow or speed up decay globally).
 *
 * We use `lastDriftAt` (or `lastUpdatedAt` if drift never ran) as the
 * reference point. A reinforced row resets `lastUpdatedAt`, so the next
 * decay tick measures from there rather than re-decaying for time the row
 * was already being updated.
 *
 * Returns the number of rows touched, for logging.
 */
export async function applyTopicBeliefDecay(opts: {
  now?: Date;
  halfLifeMultiplier?: number;
  /** Half-life override for tests; defaults to env-configured value. */
  halfLifeMs?: number;
} = {}): Promise<{ touched: number; decayed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const baseHalfLife = opts.halfLifeMs ?? DEFAULT_OPINION_HALF_LIFE_MS;
  const mult = clamp(opts.halfLifeMultiplier ?? 1, 0.25, 4);
  const halfLife = baseHalfLife * mult;

  const rows = await db.select().from(ephemeroiTopicBeliefsTable);
  let decayed = 0;
  let skipped = 0;

  for (const r of rows) {
    // Reference time = max(lastUpdatedAt, lastDriftAt). Whichever is more
    // recent is the right "elapsed since we last touched this" anchor.
    const refTime = Math.max(
      r.lastUpdatedAt.getTime(),
      r.lastDriftAt ? r.lastDriftAt.getTime() : 0,
    );
    const elapsedMs = now.getTime() - refTime;
    if (elapsedMs <= 0) {
      skipped++;
      continue;
    }
    // Exponential decay toward 0.5: distance halves every `halfLife` ms.
    const halfLives = elapsedMs / halfLife;
    if (halfLives < 0.05) {
      // Less than 5% of a half-life — not worth a write.
      skipped++;
      continue;
    }
    const distance = r.confidence - 0.5;
    const newDistance = distance * Math.pow(0.5, halfLives);
    const newConfidence = clamp(0.5 + newDistance, 0, 1);
    if (Math.abs(newConfidence - r.confidence) < 0.005) {
      // Sub-percent change — would just be churn. Skip but advance the
      // drift anchor so we don't re-evaluate the same delta next tick.
      await db
        .update(ephemeroiTopicBeliefsTable)
        .set({ lastDriftAt: now })
        .where(eq(ephemeroiTopicBeliefsTable.id, r.id));
      skipped++;
      continue;
    }

    const decayEntry = {
      stance: r.stance,
      confidence: newConfidence,
      sourceKind: "decay",
      at: now.toISOString(),
      decay: true as const,
    };
    const trimmedHistory = [decayEntry, ...((r.history ?? []) as TopicBeliefRow["history"])].slice(
      0,
      TOPIC_HISTORY_CAP,
    );

    await db
      .update(ephemeroiTopicBeliefsTable)
      .set({
        confidence: newConfidence,
        history: trimmedHistory,
        lastDriftAt: now,
        // Intentionally NOT updating lastUpdatedAt — that's reserved for
        // *evidence-driven* updates so the UI can sort by "most recently
        // talked about" rather than "most recently decayed".
      })
      .where(eq(ephemeroiTopicBeliefsTable.id, r.id));
    decayed++;
  }

  return { touched: rows.length, decayed, skipped };
}

/**
 * Find existing topic beliefs whose subject substantially overlaps the
 * given question text. Used by the Telegram answer pipeline to give the
 * Don/Wife/Son persona awareness of its own prior positions on the
 * subjects mentioned in the question.
 *
 * Two-pass match:
 *   1. Tokenize the question (length ≥ 4, lowercased), then look up
 *      candidate rows whose subject_key contains any of those tokens.
 *      We only pull rows with confidence ≥ 0.55 — opinions weaker than
 *      that aren't worth the persona's attention.
 *   2. Re-rank in JS by recency (last 14 days favored) and confidence.
 *
 * Returns at most `limit` rows, freshest+strongest first. Empty array on
 * any error or empty input — never throws.
 */
export async function findRelevantOpinionsForQuestion(
  question: string,
  limit = 3,
): Promise<TopicBeliefRow[]> {
  const tokens = Array.from(
    new Set(
      question
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4),
    ),
  ).slice(0, 12);
  if (tokens.length === 0) return [];

  try {
    // Pull all rows with confidence ≥ 0.55, then in-memory match. The
    // table is small (we cap belief growth) and cross-row text search in
    // Drizzle without trigram indexes is awkward; in-memory match keeps
    // the code simple and stays correct as the matching heuristic evolves.
    const rows = await db
      .select()
      .from(ephemeroiTopicBeliefsTable)
      .where(gte(ephemeroiTopicBeliefsTable.confidence, 0.55))
      .limit(500);
    const now = Date.now();
    const matches: Array<{ row: TopicBeliefRow; score: number }> = [];
    for (const r of rows) {
      const key = r.subjectKey.toLowerCase();
      const subj = r.subject.toLowerCase();
      let hit = false;
      for (const t of tokens) {
        if (key.includes(t) || subj.includes(t)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      // Recency bonus: full bonus within 1 day, fades to zero at 14 days.
      const ageDays = (now - r.lastUpdatedAt.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / 14);
      const score = r.confidence * (0.6 + 0.4 * recency);
      matches.push({ row: rowToTopicBelief(r), score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map((m) => m.row);
  } catch (err) {
    // Best effort — never let a stale opinion lookup break an answer.
    return [];
  }
}

function rowToTopicBelief(
  r: typeof ephemeroiTopicBeliefsTable.$inferSelect,
): TopicBeliefRow {
  return {
    id: r.id,
    subject: r.subject,
    subjectKey: r.subjectKey,
    stance: r.stance,
    confidence: r.confidence,
    evidenceCount: r.evidenceCount,
    lastEvidence: r.lastEvidence,
    lastSourceKind: r.lastSourceKind,
    lastQuestion: r.lastQuestion,
    history: (r.history ?? []) as TopicBeliefRow["history"],
    flipCount: r.flipCount,
    lastDriftAt: r.lastDriftAt,
    firstSeenAt: r.firstSeenAt,
    lastUpdatedAt: r.lastUpdatedAt,
  };
}
