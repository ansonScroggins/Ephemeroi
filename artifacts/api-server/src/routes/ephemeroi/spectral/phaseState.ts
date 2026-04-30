/**
 * Compute the current PhaseState from real database state.
 *
 * Every spectral operator invocation snapshots PhaseState before and after,
 * so this function must be cheap (a handful of indexed selects, no LLM
 * calls). Each metric is normalized to [0,1] except `stagnationSeconds`
 * which is reported in seconds (the lens controller normalizes it via a
 * configurable scale).
 */
import {
  db,
  ephemeroiBeliefsTable,
  ephemeroiObservationsTable,
  ephemeroiTopicBeliefsTable,
} from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import type { PhaseState } from "./types";

/** How many recent observations to average for the mobility metric. */
const MOBILITY_WINDOW = 50;
/** How many recent topic beliefs to scan for attractor drift. */
const ATTRACTOR_WINDOW = 30;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export async function computePhaseState(): Promise<PhaseState> {
  // 1. Illumination density = mean |confidence| across all beliefs.
  // Empty worldview → 0 (nothing illuminated yet).
  const illumRows = await db
    .select({
      avgAbsConf: sql<number>`coalesce(avg(abs(${ephemeroiBeliefsTable.confidence})), 0)`,
      supportSum: sql<number>`coalesce(sum(${ephemeroiBeliefsTable.supportCount}), 0)`,
      contradictSum: sql<number>`coalesce(sum(${ephemeroiBeliefsTable.contradictCount}), 0)`,
      n: sql<number>`count(*)`,
    })
    .from(ephemeroiBeliefsTable);
  const illuminationDensity = clamp01(Number(illumRows[0]?.avgAbsConf ?? 0));

  // 2. Phase mobility = mean novelty over the most recent observations.
  // No observations yet → 0 (we're not exploring anything).
  const novRows = await db
    .select({ novelty: ephemeroiObservationsTable.novelty })
    .from(ephemeroiObservationsTable)
    .orderBy(desc(ephemeroiObservationsTable.observedAt))
    .limit(MOBILITY_WINDOW);
  const phaseMobility =
    novRows.length === 0
      ? 0
      : clamp01(
          novRows.reduce((acc, r) => acc + Number(r.novelty || 0), 0) /
            novRows.length,
        );

  // 3. Stagnation = seconds since the most recent belief mutation.
  // No beliefs → 0 (there's nothing to stagnate yet; the lens controller
  // will instead trigger discovery via low illuminationDensity).
  const lastBeliefRow = await db
    .select({ lastUpdatedAt: ephemeroiBeliefsTable.lastUpdatedAt })
    .from(ephemeroiBeliefsTable)
    .orderBy(desc(ephemeroiBeliefsTable.lastUpdatedAt))
    .limit(1);
  const stagnationSeconds =
    lastBeliefRow.length === 0
      ? 0
      : Math.max(
          0,
          Math.floor(
            (Date.now() -
              new Date(lastBeliefRow[0]!.lastUpdatedAt).getTime()) /
              1000,
          ),
        );

  // 4. Persona imbalance = |support - contradict| / (support + contradict + 1).
  // Don dominates when support >> contradict (confident, settled);
  // Son dominates when contradict >> support (in conflict, exploring);
  // Wife is balanced. We surface the magnitude only — the sign is
  // recoverable from the support/contradict columns directly.
  const support = Number(illumRows[0]?.supportSum ?? 0);
  const contradict = Number(illumRows[0]?.contradictSum ?? 0);
  const personaImbalance = clamp01(
    Math.abs(support - contradict) / (support + contradict + 1),
  );

  // 5. Attractor drift = stddev-normalized recent stance flips.
  // Pull the most recent N topic beliefs and average their flipCount,
  // normalized by evidenceCount so a chronic flipper has higher drift
  // than a single 1/2 flipper. Empty → 0.
  const driftRows = await db
    .select({
      flipCount: ephemeroiTopicBeliefsTable.flipCount,
      evidenceCount: ephemeroiTopicBeliefsTable.evidenceCount,
    })
    .from(ephemeroiTopicBeliefsTable)
    .orderBy(desc(ephemeroiTopicBeliefsTable.lastUpdatedAt))
    .limit(ATTRACTOR_WINDOW);
  const attractorDrift =
    driftRows.length === 0
      ? 0
      : clamp01(
          driftRows.reduce(
            (acc, r) =>
              acc +
              Number(r.flipCount || 0) /
                Math.max(1, Number(r.evidenceCount || 1)),
            0,
          ) / driftRows.length,
        );

  return {
    illuminationDensity,
    phaseMobility,
    stagnationSeconds,
    personaImbalance,
    attractorDrift,
  };
}
