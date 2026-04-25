import {
  db,
  ephemeroiSettingsTable,
  ephemeroiSourcesTable,
  ephemeroiObservationsTable,
  ephemeroiBeliefsTable,
  ephemeroiContradictionsTable,
  ephemeroiReportsTable,
} from "@workspace/db";
import { eq, desc, asc, and } from "drizzle-orm";

// ===== Settings (singleton) =====

export interface SettingsRow {
  id: number;
  intervalSeconds: number;
  importanceThreshold: number;
  paused: boolean;
  telegramEnabled: boolean;
  noveltyWeight: number;
  noveltyDecay: number;
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
  await db
    .update(ephemeroiSettingsTable)
    .set(next)
    .where(eq(ephemeroiSettingsTable.id, current.id));
  return getSettings();
}

// ===== Sources =====

export type SourceKind = "rss" | "url" | "search";

export interface SourceRow {
  id: number;
  kind: SourceKind;
  label: string;
  target: string;
  active: boolean;
  lastPolledAt: Date | null;
  lastError: string | null;
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
}): Promise<SourceRow> {
  const label = input.label?.trim() || deriveLabel(input.kind, input.target);
  const inserted = await db
    .insert(ephemeroiSourcesTable)
    .values({
      kind: input.kind,
      target: input.target,
      label,
      active: true,
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

function deriveLabel(kind: SourceKind, target: string): string {
  if (kind === "search") return `Search: ${target}`;
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
    })
    .returning();
  return rowToBelief(inserted[0]!);
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
