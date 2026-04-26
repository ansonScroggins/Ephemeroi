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
import { eq, desc, asc, and, sql } from "drizzle-orm";

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
    await db
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
      .where(eq(ephemeroiBeliefsTable.id, existing.id));
    const updated = await findBeliefByProposition(input.proposition);
    return updated!;
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
  }>;
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
 * Upsert a topic belief by subjectKey. On first sight: insert with
 * evidenceCount=1 and a single-entry history. On subsequent sight: bump
 * stance/confidence/evidence in place and prepend a history entry (capped
 * at TOPIC_HISTORY_CAP). Returns the resulting row so callers can log the
 * delta if useful.
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

  const newHistoryEntry = {
    stance,
    confidence,
    ...(evidence ? { evidence } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    at: now.toISOString(),
  };

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
            firstSeenAt: now,
            lastUpdatedAt: now,
          })
          .returning();
        return rowToTopicBelief(inserted[0]!);
      }

      const prev = existing[0]!;
      const trimmedHistory = [newHistoryEntry, ...(prev.history ?? [])].slice(
        0,
        TOPIC_HISTORY_CAP,
      );
      const updated = await tx
        .update(ephemeroiTopicBeliefsTable)
        .set({
          // Keep the original human-readable subject the first time we saw
          // it — re-extractions produce slightly different casings that all
          // map to the same key, but the first form is usually the cleanest.
          stance,
          confidence,
          evidenceCount: prev.evidenceCount + 1,
          lastEvidence: evidence,
          lastSourceKind: sourceKind,
          lastQuestion: question,
          history: trimmedHistory,
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
    firstSeenAt: r.firstSeenAt,
    lastUpdatedAt: r.lastUpdatedAt,
  };
}
