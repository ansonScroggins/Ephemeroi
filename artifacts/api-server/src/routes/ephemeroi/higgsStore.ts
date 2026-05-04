/**
 * Persistence helpers for Higgs Phase Transition runs.
 */
import { db, ephemeroiHiggsRunsTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import type { HiggsOutcome, HiggsSnapshot } from "./higgs";

export interface InsertHiggsRunInput {
  outcome: HiggsOutcome;
  finalUnsat: number;
  totalSteps: number;
  nVars: number;
  nClauses: number;
  seed: number;
  logInterval: number;
  sampleSize: number;
  snapshots: HiggsSnapshot[];
  durationMs: number;
}

export interface HiggsRunRow {
  id: number;
  outcome: HiggsOutcome;
  finalUnsat: number;
  totalSteps: number;
  nVars: number;
  nClauses: number;
  seed: number;
  logInterval: number;
  sampleSize: number;
  snapshots: HiggsSnapshot[];
  durationMs: number;
  createdAt: string;
}

export interface HiggsRunSummary {
  id: number;
  outcome: HiggsOutcome;
  finalUnsat: number;
  totalSteps: number;
  nVars: number;
  nClauses: number;
  durationMs: number;
  snapshotCount: number;
  createdAt: string;
}

function rowToRecord(r: typeof ephemeroiHiggsRunsTable.$inferSelect): HiggsRunRow {
  return {
    id: r.id,
    outcome: r.outcome as HiggsOutcome,
    finalUnsat: r.finalUnsat,
    totalSteps: r.totalSteps,
    nVars: r.nVars,
    nClauses: r.nClauses,
    seed: r.seed,
    logInterval: r.logInterval,
    sampleSize: r.sampleSize,
    snapshots: (r.snapshots ?? []) as HiggsSnapshot[],
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function insertHiggsRun(
  input: InsertHiggsRunInput,
): Promise<HiggsRunRow> {
  const inserted = await db
    .insert(ephemeroiHiggsRunsTable)
    .values({
      outcome: input.outcome,
      finalUnsat: input.finalUnsat,
      totalSteps: input.totalSteps,
      nVars: input.nVars,
      nClauses: input.nClauses,
      seed: input.seed,
      logInterval: input.logInterval,
      sampleSize: input.sampleSize,
      snapshots: input.snapshots,
      durationMs: input.durationMs,
    })
    .returning();
  return rowToRecord(inserted[0]!);
}

/**
 * List recent Higgs runs without the snapshots blob (cheap to render in
 * a table). Optionally filter by outcome bucket.
 */
export async function listHiggsRunSummaries(
  limit: number,
  outcome?: HiggsOutcome,
): Promise<HiggsRunSummary[]> {
  const cap = Math.max(1, Math.min(500, limit));
  const where = outcome
    ? and(eq(ephemeroiHiggsRunsTable.outcome, outcome))
    : undefined;
  const rows = await db
    .select({
      id: ephemeroiHiggsRunsTable.id,
      outcome: ephemeroiHiggsRunsTable.outcome,
      finalUnsat: ephemeroiHiggsRunsTable.finalUnsat,
      totalSteps: ephemeroiHiggsRunsTable.totalSteps,
      nVars: ephemeroiHiggsRunsTable.nVars,
      nClauses: ephemeroiHiggsRunsTable.nClauses,
      durationMs: ephemeroiHiggsRunsTable.durationMs,
      snapshotCount: sql<number>`coalesce(jsonb_array_length(${ephemeroiHiggsRunsTable.snapshots}), 0)`,
      createdAt: ephemeroiHiggsRunsTable.createdAt,
    })
    .from(ephemeroiHiggsRunsTable)
    .where(where)
    .orderBy(desc(ephemeroiHiggsRunsTable.createdAt))
    .limit(cap);
  return rows.map((r) => ({
    id: r.id,
    outcome: r.outcome as HiggsOutcome,
    finalUnsat: r.finalUnsat,
    totalSteps: r.totalSteps,
    nVars: r.nVars,
    nClauses: r.nClauses,
    durationMs: r.durationMs,
    snapshotCount: Number(r.snapshotCount ?? 0),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getHiggsRun(id: number): Promise<HiggsRunRow | null> {
  const rows = await db
    .select()
    .from(ephemeroiHiggsRunsTable)
    .where(eq(ephemeroiHiggsRunsTable.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToRecord(rows[0]!);
}

/**
 * Pull recent runs *with* their snapshot trajectories, suitable input for
 * `analyzeHiggsRuns`. Capped to keep memory bounded.
 */
export async function listHiggsRunsForAnalysis(
  limit: number,
): Promise<HiggsRunRow[]> {
  const cap = Math.max(1, Math.min(500, limit));
  const rows = await db
    .select()
    .from(ephemeroiHiggsRunsTable)
    .orderBy(desc(ephemeroiHiggsRunsTable.createdAt))
    .limit(cap);
  return rows.map(rowToRecord);
}
