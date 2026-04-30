/**
 * Lens-controller selection algorithm.
 *
 * Given the current PhaseState, score every available spectral operator
 * by how well its expected effect addresses what the phase state needs,
 * then pick the highest-scoring operator. Returns the chosen operator
 * plus a short human-readable reason that gets persisted on the
 * invocation row.
 *
 * The scoring is intentionally a simple linear combination — the
 * lens-controller is supposed to be transparent and tunable, not an
 * opaque LLM call. The user can always invoke a specific operator
 * directly via the API.
 */
import type {
  PhaseState,
  SpectralOperator,
} from "./types";
import { listOperators } from "./operators";

/**
 * Stagnation is reported in seconds; map it onto [0,1] with a saturating
 * curve so a 5-minute idle worldview already counts as "very stagnant"
 * for selection purposes (matches the loop's default 5-min interval).
 */
function stagnationPressure(stagnationSeconds: number): number {
  const halfLifeSeconds = 60; // 1 minute → 0.5; 2 minutes → ~0.67; 5 minutes → ~0.85
  return 1 - Math.exp(-stagnationSeconds / (halfLifeSeconds * Math.LOG2E));
}

interface SelectionScore {
  operator: SpectralOperator;
  score: number;
  reason: string;
}

/**
 * Compute the demand vector from the phase state. Each component is a
 * non-negative pressure for one kind of cognitive move:
 *   illumDemand    — high when worldview is murky (low illuminationDensity)
 *   mobilityDemand — high when stuck (low phaseMobility OR high stagnation)
 *   structureDemand— high when chaotic (high attractorDrift)
 *   trimDemand     — high when over-confident-and-stagnant (so we should forget)
 */
function demand(state: PhaseState): {
  illum: number;
  mobility: number;
  structure: number;
  trim: number;
} {
  const stag = stagnationPressure(state.stagnationSeconds);
  return {
    illum: 1 - state.illuminationDensity,
    mobility: Math.max(1 - state.phaseMobility, stag),
    structure: state.attractorDrift,
    // We want to forget when we have a strong-and-stale picture (high
    // illumination AND high stagnation) — that's the signature of a
    // belief set that has stopped responding to the world.
    trim: state.illuminationDensity * stag,
  };
}

export async function selectOperator(
  state: PhaseState,
): Promise<SelectionScore> {
  const d = demand(state);
  // Feasibility filter: drop operators whose `feasible()` says no — we
  // never want the lens controller to pick something that we already
  // know will throw NoTargetError on settings grounds (the most common
  // case is `phase-kick-expansion` when autonomy is off).
  const all = listOperators();
  const feasibilityChecks = await Promise.all(
    all.map(async (op) => (op.feasible ? await op.feasible() : true)),
  );
  const eligible = all.filter((_, i) => feasibilityChecks[i]);
  const pool = eligible.length > 0 ? eligible : all;
  const scored: SelectionScore[] = pool.map((op) => {
    const e = op.expectedEffect;
    // Score = how well the operator's expected effect satisfies demand.
    // Negative effects are interpreted as "this operator reduces that
    // axis" — so they only score positively for the matching demand
    // (e.g. negative illumination effect satisfies trim demand).
    let score =
      Math.max(0, e.illumination) * d.illum +
      Math.max(0, e.mobility) * d.mobility +
      Math.max(0, e.structure) * d.structure +
      Math.max(0, -e.illumination) * d.trim +
      Math.max(0, -e.structure) * d.trim;
    // Tiny tie-breaker: prefer the most "specific" operator (single-phase
    // signature) when scores are otherwise equal, so the lens controller
    // doesn't drift toward Prism-class meta-ops.
    score += op.signature.length === 1 ? 0.001 : 0;
    return {
      operator: op,
      score,
      reason: explain(op.name, d),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  // Fallback: if every score is zero (quiescent worldview) the lens
  // controller defaults to belief-stabilization — strengthening what we
  // already have is the safe move.
  const winner = scored[0]!;
  if (winner.score === 0) {
    const fallback = scored.find(
      (s) => s.operator.name === "belief-stabilization",
    );
    if (fallback) {
      return {
        ...fallback,
        reason: "quiescent state — defaulting to belief-stabilization",
      };
    }
  }
  return winner;
}

function explain(
  name: string,
  d: { illum: number; mobility: number; structure: number; trim: number },
): string {
  const dominant = Object.entries(d).sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return name;
  const [axis, value] = dominant;
  const fmt = value.toFixed(2);
  switch (axis) {
    case "illum":
      return `low illumination (demand ${fmt}) — running ${name}`;
    case "mobility":
      return `stagnation/low mobility (demand ${fmt}) — running ${name}`;
    case "structure":
      return `attractor drift (demand ${fmt}) — running ${name}`;
    case "trim":
      return `stale strong picture (demand ${fmt}) — running ${name}`;
    default:
      return name;
  }
}
