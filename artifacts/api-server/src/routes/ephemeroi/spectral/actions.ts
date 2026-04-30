/**
 * Concrete implementations of each spectral operator.
 *
 * Every action mutates real DB state via the existing store helpers
 * (`upsertBelief`, `trimBelief`, etc.) — there is no shadow data layer.
 * If an action cannot find anything to act on (e.g. no beliefs exist
 * yet), it throws a `NoTargetError` so the runner can record
 * `success=false` with a clear narration.
 */
import {
  db,
  ephemeroiBeliefsTable,
  ephemeroiContradictionsTable,
  ephemeroiSourceStateTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  getSettings,
  listBeliefs,
  listContradictions,
  listRecentObservations,
  trimBelief,
} from "../store";
import { runDiscovery } from "../discover";

export class NoTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoTargetError";
  }
}

interface ActionResult {
  narration: string;
  effect: Record<string, unknown>;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * LIGHT — Illumination Collapse.
 *
 * Find the highest-supportCount belief whose |confidence| < 0.5 (still
 * "Forming") and nudge its confidence in the direction the support points
 * (positive if more supports than contradicts, negative otherwise) by a
 * small fixed step. Real DB UPDATE; idempotent in shape (each call is
 * one step).
 */
export async function illuminationCollapse(): Promise<ActionResult> {
  const candidates = await db
    .select({
      id: ephemeroiBeliefsTable.id,
      proposition: ephemeroiBeliefsTable.proposition,
      confidence: ephemeroiBeliefsTable.confidence,
      supportCount: ephemeroiBeliefsTable.supportCount,
      contradictCount: ephemeroiBeliefsTable.contradictCount,
    })
    .from(ephemeroiBeliefsTable)
    .where(sql`abs(${ephemeroiBeliefsTable.confidence}) < 0.5`)
    .orderBy(desc(ephemeroiBeliefsTable.supportCount))
    .limit(1);

  if (candidates.length === 0) {
    throw new NoTargetError(
      "No forming beliefs (|confidence|<0.5) to collapse around.",
    );
  }

  const target = candidates[0]!;
  const direction =
    target.supportCount >= target.contradictCount ? +1 : -1;
  const step = 0.1;
  const newConfidence = clamp(target.confidence + direction * step, -1, 1);

  const updated = await db
    .update(ephemeroiBeliefsTable)
    .set({
      confidence: newConfidence,
      lastUpdatedAt: new Date(),
    })
    .where(eq(ephemeroiBeliefsTable.id, target.id))
    .returning();

  if (updated.length === 0) {
    throw new NoTargetError(
      `Belief #${target.id} disappeared mid-collapse.`,
    );
  }

  return {
    narration: `Collapsed illumination around belief #${target.id} "${truncate(target.proposition, 60)}": ${target.confidence.toFixed(2)} → ${newConfidence.toFixed(2)}.`,
    effect: {
      action: "illumination-collapse",
      beliefId: target.id,
      beliefProposition: target.proposition,
      confidenceBefore: target.confidence,
      confidenceAfter: newConfidence,
      direction,
    },
  };
}

/**
 * LIGHT + GRAVITY — Contradiction Collapse.
 *
 * Find the most recent UNRESOLVED contradiction. If the linked belief
 * exists and has more contradicts than supports, trim it by 50% (it's
 * losing the argument). Either way, mark the contradiction resolved.
 */
export async function contradictionCollapse(): Promise<ActionResult> {
  const open = await db
    .select()
    .from(ephemeroiContradictionsTable)
    .where(eq(ephemeroiContradictionsTable.resolved, false))
    .orderBy(desc(ephemeroiContradictionsTable.detectedAt))
    .limit(1);

  if (open.length === 0) {
    throw new NoTargetError("No unresolved contradictions to collapse.");
  }

  const c = open[0]!;
  let trimmed = false;
  let trimmedBeliefId: number | null = null;
  let confidenceBefore: number | null = null;
  let confidenceAfter: number | null = null;
  let beliefProposition: string | null = null;

  if (c.beliefId !== null) {
    const beliefRows = await db
      .select()
      .from(ephemeroiBeliefsTable)
      .where(eq(ephemeroiBeliefsTable.id, c.beliefId))
      .limit(1);
    const belief = beliefRows[0];
    if (belief && belief.contradictCount > belief.supportCount) {
      confidenceBefore = belief.confidence;
      beliefProposition = belief.proposition;
      const updated = await trimBelief(belief.id, 0.5);
      if (updated) {
        trimmed = true;
        trimmedBeliefId = belief.id;
        confidenceAfter = updated.confidence;
      }
    }
  }

  await db
    .update(ephemeroiContradictionsTable)
    .set({ resolved: true })
    .where(eq(ephemeroiContradictionsTable.id, c.id));

  const narration = trimmed
    ? `Contradiction #${c.id} resolved by trimming losing belief #${trimmedBeliefId} "${truncate(beliefProposition!, 50)}" 50%.`
    : `Contradiction #${c.id} resolved (no belief trim — supports still win).`;

  return {
    narration,
    effect: {
      action: "contradiction-collapse",
      contradictionId: c.id,
      summary: c.summary,
      trimmed,
      trimmedBeliefId,
      confidenceBefore,
      confidenceAfter,
    },
  };
}

/**
 * GRAVITY — Belief Stabilization.
 *
 * Find the highest-supportCount belief with positive confidence and nudge
 * its confidence further toward +1 by a small step (capped). This is the
 * "lock in what we know" move — opposite of trim/clear.
 */
export async function beliefStabilization(): Promise<ActionResult> {
  const rows = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .where(sql`${ephemeroiBeliefsTable.confidence} > 0`)
    .orderBy(
      desc(ephemeroiBeliefsTable.supportCount),
      desc(ephemeroiBeliefsTable.confidence),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new NoTargetError(
      "No positively-held beliefs to stabilize.",
    );
  }
  const target = rows[0]!;
  const step = Math.min(0.05, 1 - target.confidence);
  if (step <= 0) {
    throw new NoTargetError(
      `Belief #${target.id} is already at maximum confidence.`,
    );
  }
  const newConfidence = clamp(target.confidence + step, -1, 1);
  const updated = await db
    .update(ephemeroiBeliefsTable)
    .set({ confidence: newConfidence, lastUpdatedAt: new Date() })
    .where(eq(ephemeroiBeliefsTable.id, target.id))
    .returning();
  if (updated.length === 0) {
    throw new NoTargetError(
      `Belief #${target.id} disappeared mid-stabilization.`,
    );
  }
  return {
    narration: `Stabilized belief #${target.id} "${truncate(target.proposition, 60)}": ${target.confidence.toFixed(2)} → ${newConfidence.toFixed(2)}.`,
    effect: {
      action: "belief-stabilization",
      beliefId: target.id,
      beliefProposition: target.proposition,
      confidenceBefore: target.confidence,
      confidenceAfter: newConfidence,
    },
  };
}

/**
 * ENERGY — Phase-Kick Expansion.
 *
 * Trigger a real discovery pass. Discovery scans recent observations for
 * GitHub references and (if autonomy is allowed) adds new sources for the
 * agent to watch. This is the only operator that can grow the agent's
 * watchlist — the actual "explore new regions" move.
 *
 * If autonomy is disabled in settings, discovery is a no-op and we throw
 * NoTargetError so the runner records why it didn't move.
 */
export async function phaseKickExpansion(): Promise<ActionResult> {
  const settings = await getSettings();
  if (!settings.autonomyEnabled) {
    throw new NoTargetError(
      "Autonomy disabled in settings — cannot expand watchlist via phase-kick. Enable autonomy or invoke a different operator.",
    );
  }
  // Mirror the inputs the main loop assembles for runDiscovery: recent
  // observations as the source of GitHub references, current beliefs as
  // context, and the open contradictions as "questions Ephemeroi is
  // grappling with" so discovery picks sources that might resolve them.
  const [observations, beliefs, contradictions] = await Promise.all([
    listRecentObservations(50),
    listBeliefs(),
    listContradictions(),
  ]);
  const beliefSummaries = beliefs.slice(0, 30).map((b) => ({
    id: b.id,
    proposition: b.proposition,
    confidence: b.confidence,
  }));
  const openQuestions = contradictions
    .filter((c) => !c.resolved)
    .slice(0, 10)
    .map((c) => c.summary);

  const result = await runDiscovery({
    observations,
    beliefs: beliefSummaries,
    openQuestions,
    autonomyMaxSources: settings.autonomyMaxSources,
  });

  if (result.added.length === 0) {
    const skippedReason =
      result.skipped[0]?.reason ?? "no GitHub references in recent observations";
    throw new NoTargetError(
      `Discovery considered ${result.considered} candidate${result.considered === 1 ? "" : "s"} but added nothing (${skippedReason}).`,
    );
  }
  const labels = result.added.map((a) => `${a.kind}:${a.target}`);
  return {
    narration: `Phase-kick: discovery added ${result.added.length} new source${result.added.length === 1 ? "" : "s"} — ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "…" : ""}.`,
    effect: {
      action: "phase-kick-expansion",
      sourcesAdded: result.added.length,
      considered: result.considered,
      added: result.added,
    },
  };
}

/**
 * ENERGY — Collatz Kick (structured perturbation).
 *
 * Pick a low-confidence (|conf|<0.3) belief with at least 2 supports and
 * trim it by 50%. The asymmetry vs. illumination-collapse is that this
 * one acts on near-zero beliefs that are stuck, deliberately *reducing*
 * their weight to break the inertia and let new evidence repopulate.
 */
export async function collatzKick(): Promise<ActionResult> {
  const candidates = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .where(
      and(
        sql`abs(${ephemeroiBeliefsTable.confidence}) < 0.3`,
        sql`${ephemeroiBeliefsTable.supportCount} >= 2`,
      ),
    )
    .orderBy(asc(ephemeroiBeliefsTable.lastUpdatedAt))
    .limit(5);

  if (candidates.length === 0) {
    throw new NoTargetError(
      "No stagnant low-confidence beliefs to kick (need |conf|<0.3, supports≥2).",
    );
  }

  // Pick uniformly from the top 5 oldest stuck beliefs.
  const target = candidates[Math.floor(Math.random() * candidates.length)]!;
  const before = {
    confidence: target.confidence,
    supportCount: target.supportCount,
    contradictCount: target.contradictCount,
  };
  const updated = await trimBelief(target.id, 0.5);
  if (!updated) {
    throw new NoTargetError(
      `Belief #${target.id} disappeared mid-kick.`,
    );
  }
  return {
    narration: `Collatz kick on belief #${target.id} "${truncate(target.proposition, 60)}": conf ${before.confidence.toFixed(2)}→${updated.confidence.toFixed(2)}, supports ${before.supportCount}→${updated.supportCount}.`,
    effect: {
      action: "collatz-kick",
      beliefId: target.id,
      beliefProposition: target.proposition,
      before,
      after: {
        confidence: updated.confidence,
        supportCount: updated.supportCount,
        contradictCount: updated.contradictCount,
      },
    },
  };
}

/**
 * TIME — Temporal Smoothing.
 *
 * Find the oldest non-dormant belief (smallest lastUpdatedAt, |conf|>0)
 * and apply a gentle 0.95 keepFraction trim. This is passive forgetting
 * — the long-term complement to the active prune (Clear/Trim) UI.
 */
export async function temporalSmoothing(): Promise<ActionResult> {
  const candidates = await db
    .select()
    .from(ephemeroiBeliefsTable)
    .where(
      or(
        sql`${ephemeroiBeliefsTable.confidence} > 0.05`,
        sql`${ephemeroiBeliefsTable.confidence} < -0.05`,
      ),
    )
    .orderBy(asc(ephemeroiBeliefsTable.lastUpdatedAt))
    .limit(1);
  if (candidates.length === 0) {
    throw new NoTargetError(
      "No active beliefs to smooth (all are already near zero).",
    );
  }
  const target = candidates[0]!;
  const ageSeconds = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(target.lastUpdatedAt).getTime()) / 1000,
    ),
  );
  const updated = await trimBelief(target.id, 0.95);
  if (!updated) {
    throw new NoTargetError(
      `Belief #${target.id} disappeared mid-smoothing.`,
    );
  }
  return {
    narration: `Temporal smoothing on belief #${target.id} (${formatAge(ageSeconds)} old): conf ${target.confidence.toFixed(3)}→${updated.confidence.toFixed(3)}.`,
    effect: {
      action: "temporal-smoothing",
      beliefId: target.id,
      beliefProposition: target.proposition,
      ageSeconds,
      confidenceBefore: target.confidence,
      confidenceAfter: updated.confidence,
    },
  };
}

/**
 * TIME — Source-State Decay.
 *
 * Find the most stale `ephemeroi_source_state` row (smallest `updatedAt`)
 * and gently regress its 4D constellation vector
 * (capability/integrity/usability/trust) toward the 0.5 baseline by a
 * small step. This is the source-side complement to `temporal-smoothing`
 * — when a source has been silent for a while, our calibration of it
 * should drift back to neutral rather than stay locked at whatever its
 * last reflection said. Real UPDATE on the source-state table.
 */
export async function sourceStateDecay(): Promise<ActionResult> {
  const rows = await db
    .select()
    .from(ephemeroiSourceStateTable)
    .orderBy(asc(ephemeroiSourceStateTable.updatedAt))
    .limit(1);
  if (rows.length === 0) {
    throw new NoTargetError(
      "No source-state rows yet — run a cycle first so sources have a constellation vector.",
    );
  }
  const target = rows[0]!;
  const decay = 0.05;
  const baseline = 0.5;
  const next = {
    capability: nudgeToward(target.capability, baseline, decay),
    integrity: nudgeToward(target.integrity, baseline, decay),
    usability: nudgeToward(target.usability, baseline, decay),
    trust: nudgeToward(target.trust, baseline, decay),
  };
  // Only persist if anything actually moved (cheap idempotency guard).
  const moved =
    next.capability !== target.capability ||
    next.integrity !== target.integrity ||
    next.usability !== target.usability ||
    next.trust !== target.trust;
  if (!moved) {
    throw new NoTargetError(
      `Source #${target.sourceId} is already at baseline — nothing to decay.`,
    );
  }
  const ageSeconds = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(target.updatedAt).getTime()) / 1000,
    ),
  );
  const updated = await db
    .update(ephemeroiSourceStateTable)
    .set({
      capability: next.capability,
      integrity: next.integrity,
      usability: next.usability,
      trust: next.trust,
      lastDeltaCapability: next.capability - target.capability,
      lastDeltaIntegrity: next.integrity - target.integrity,
      lastDeltaUsability: next.usability - target.usability,
      lastDeltaTrust: next.trust - target.trust,
      updatedAt: new Date(),
    })
    .where(eq(ephemeroiSourceStateTable.id, target.id))
    .returning();
  if (updated.length === 0) {
    throw new NoTargetError(
      `Source-state #${target.id} disappeared mid-decay.`,
    );
  }
  return {
    narration: `Source-state decay on source #${target.sourceId} (${formatAge(ageSeconds)} since last update): trust ${target.trust.toFixed(2)}→${next.trust.toFixed(2)}, integrity ${target.integrity.toFixed(2)}→${next.integrity.toFixed(2)}.`,
    effect: {
      action: "source-state-decay",
      sourceStateId: target.id,
      sourceId: target.sourceId,
      ageSeconds,
      before: {
        capability: target.capability,
        integrity: target.integrity,
        usability: target.usability,
        trust: target.trust,
      },
      after: next,
    },
  };
}

function nudgeToward(value: number, target: number, step: number): number {
  if (Math.abs(value - target) <= step) return target;
  return value + (target > value ? step : -step);
}

// ===== helpers =====

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// keep a single un-used import suppressor (drizzle types referenced for clarity)
void isNull;
