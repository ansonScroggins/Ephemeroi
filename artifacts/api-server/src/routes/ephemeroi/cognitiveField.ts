import { logger } from "../../lib/logger";

/**
 * Cognitive Field — the unified substrate that ties the biomimetic
 * constraint-field solver to the bot's opinion dynamics and answering voice.
 *
 * The biomimetic protocol produces a snapshot of the system's *cognitive
 * weather* on every run: how settled the variable assignments are
 * (consensus), how turbulent the unsatisfied-clause field is (pressure
 * variance), and how often the Cyrus Edict had to fire (the cage rate).
 *
 * That same cognitive weather is read by:
 *   * The opinion-decay sweep, which slows decay when the field is settled
 *     (the bot is in a coherent state, opinions stick) and accelerates it
 *     when the field is turbulent (the bot is mid-revision, old positions
 *     should fade faster).
 *   * The Don/Wife/Son persona, which gets a one-line tonal directive based
 *     on the same field metrics — settled → decisive, turbulent → urgent,
 *     post-cage → conflicted.
 *
 * This module is intentionally tiny and stateless beyond a single in-process
 * snapshot. We don't persist the field to the DB because the biomimetic
 * runner is in the same process and the snapshot only needs to survive
 * for the lifetime of the api-server. A restart simply means "no field yet"
 * and downstream consumers fall back to neutral defaults — which is the
 * correct behavior, since the field is only meaningful relative to a
 * recent run.
 */

export interface CognitiveFieldSnapshot {
  /**
   * Mean of the consensus_map at the end of the run, in [0, 1]. High means
   * the system reached a confident assignment (most variables are happy
   * where they are). Low means lots of variables are still oscillating.
   */
  consensusMean: number;
  /**
   * Pressure variance at the end of the run. Higher = more concentrated
   * stress on a few variables (a coherent strain). Lower = the unsat is
   * spread thinly. We normalize this to [0, 1] before exposing it.
   */
  turbulence: number;
  /**
   * How many cages the run hit, scaled to [0, 1] by a soft cap (4 cages →
   * full conflict). Cages are the dramatic moment when the spliceosome
   * step couldn't dislodge a stable-but-wrong attractor and the Edict had
   * to cascade-flip variables to break out.
   */
  conflict: number;
  /** Was unsat driven to 0? */
  solved: boolean;
  /** When this snapshot was captured. */
  capturedAt: Date;
}

/**
 * Coarse mood label derived from the snapshot. Pure function of the field
 * — exposed separately so the persona/decay code can switch on it without
 * re-implementing the same thresholds in two places.
 */
export type CognitiveMood = "settled" | "contested" | "oscillating" | "neutral";

let latest: CognitiveFieldSnapshot | null = null;

/**
 * Called by the biomimetic runner at the end of every successful run.
 * Idempotent — a fresh snapshot just replaces the previous one.
 */
export function recordBiomimeticField(input: {
  consensusMean: number;
  pressureVariance: number;
  cageEvents: number;
  solved: boolean;
}): void {
  // Soft-cap pressure variance into a [0, 1] turbulence number. The raw
  // variance is unbounded above and depends on n; the values we observe in
  // practice fall in the [0, 5] range for n=24, so we normalize against
  // a denominator that maps the typical regime cleanly into [0, 1] without
  // saturating too early.
  const turbulence = Math.max(
    0,
    Math.min(1, input.pressureVariance / 4),
  );
  // Same idea for cages: 0 → 0 conflict, 4+ → full conflict.
  const conflict = Math.max(0, Math.min(1, input.cageEvents / 4));
  const consensusMean = Math.max(0, Math.min(1, input.consensusMean));

  latest = {
    consensusMean,
    turbulence,
    conflict,
    solved: input.solved,
    capturedAt: new Date(),
  };
  logger.info(
    { consensusMean, turbulence, conflict, solved: input.solved },
    "cognitiveField: snapshot recorded",
  );
}

/** Returns the most recent field snapshot, or null if no run yet. */
export function getCognitiveField(): CognitiveFieldSnapshot | null {
  return latest;
}

/**
 * Coarse mood derived from the snapshot.
 *   * settled   — high consensus AND low turbulence → opinions stick
 *   * contested — high turbulence regardless of consensus → opinions move
 *   * oscillating — recent cage events → opinions flip more easily
 *   * neutral   — no snapshot yet, or in-between values
 */
export function getCognitiveMood(): CognitiveMood {
  if (!latest) return "neutral";
  if (latest.conflict >= 0.5) return "oscillating";
  if (latest.turbulence >= 0.5) return "contested";
  if (latest.consensusMean >= 0.6 && latest.turbulence < 0.3) return "settled";
  return "neutral";
}

/**
 * Multiplier on the opinion-decay half-life. Settled field → opinions
 * decay slower (longer half-life, multiplier > 1). Contested or
 * oscillating → opinions decay faster (multiplier < 1). Neutral → 1.
 *
 * Bounded to [0.5, 2.0] so a single biomimetic run can never turn the
 * decay into either a no-op or a stampede.
 */
export function decayHalfLifeMultiplier(): number {
  const mood = getCognitiveMood();
  switch (mood) {
    case "settled":
      return 1.7;
    case "contested":
      return 0.7;
    case "oscillating":
      return 0.55;
    default:
      return 1.0;
  }
}

/**
 * One-line tonal directive for the Don/Wife/Son persona, derived from the
 * field. Returns null when the field is neutral so the persona prompt
 * doesn't add a noisy directive when there's nothing to say.
 */
export function personaMoodDirective(): string | null {
  const field = latest;
  if (!field) return null;
  switch (getCognitiveMood()) {
    case "settled":
      return `Cognitive field is settled (consensus ${field.consensusMean.toFixed(2)}, turbulence ${field.turbulence.toFixed(2)}). The Don should be especially decisive — the inner constraint solver has reached a coherent state, so don't hedge.`;
    case "contested":
      return `Cognitive field is contested (turbulence ${field.turbulence.toFixed(2)}). The Wife should push harder than usual — the inner solver is mid-revision, so foreground tension over a clean answer.`;
    case "oscillating":
      return `Cognitive field is oscillating (recent cage events). The Don should acknowledge his own uncertainty briefly — the inner solver just had to break out of a stable-but-wrong attractor, and that conflict deserves a line of honesty.`;
    default:
      return null;
  }
}

/** Test/debug only — wipes the in-memory snapshot. */
export function _resetCognitiveFieldForTests(): void {
  latest = null;
}
