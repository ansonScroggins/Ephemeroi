/**
 * Higgs Phase Transition Analysis for the biomimetic SAT solver.
 *
 * Direct port of the Python research module attached by the user. The
 * solver-internal symmetry-breaking signal is computed from the
 * per-variable "mass" — the change in the unsat count when a variable
 * is flipped:
 *
 *   - mass(v) > 0  → flipping v makes things worse (heavy / locked).
 *   - mass(v) < 0  → flipping v helps (light / mobile).
 *   - mass(v) ≈ 0  → neutral.
 *
 * At each logged step we sample K variables and compute:
 *
 *   - fieldStrength  = mean(masses)
 *   - fieldVariance  = variance(masses)
 *   - orderParameter = fieldVariance / (|fieldStrength| + ε)
 *
 * `orderParameter` is the symmetry-breaking signal: it stays near zero
 * while the field is symmetric and rises as structure forms. Solved runs
 * tend to peak then collapse (the broken phase resolves at solve);
 * stuck runs plateau (the field locks rigid).
 *
 * The cross-run analyzer (`analyzeHiggsRuns`) builds order-parameter
 * profiles per outcome bucket, detects the threshold-crossing step, and
 * surfaces the divergence between `solved` and `stuck_hard` profiles
 * (the earliest reliable prediction window).
 */

import type { Clause } from "./biomimetic";

// ===== Field snapshot types =====

export type HiggsOutcome = "solved" | "stuck_soft" | "stuck_hard";

export interface HiggsSnapshot {
  step: number;
  unsat: number;
  fieldStrength: number;
  fieldVariance: number;
  orderParameter: number;
  massMin: number;
  massMax: number;
  heavyNegFrac: number;
  neutralFrac: number;
  heavyPosFrac: number;
}

export interface HiggsRun {
  outcome: HiggsOutcome;
  finalUnsat: number;
  totalSteps: number;
  snapshots: HiggsSnapshot[];
}

// ===== Core field computations =====

/**
 * Count clauses unsatisfied under the current assignment.
 * Mirrors `computeUnsat` in biomimetic.ts but lives here so the higgs
 * module can stay self-contained (no risk of import cycles).
 */
function countUnsat(clauses: Clause[], assignment: Uint8Array): number {
  let unsat = 0;
  for (const clause of clauses) {
    let satisfied = false;
    for (const lit of clause) {
      const v = Math.abs(lit) - 1;
      const want: 0 | 1 = lit > 0 ? 1 : 0;
      if (assignment[v] === want) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) unsat++;
  }
  return unsat;
}

/**
 * Mass of variable `v` (0-indexed) = Δ unsat when flipped. Positive
 * means flipping makes things worse (heavy), negative means flipping
 * helps (light). The flip is undone before returning so the solver's
 * assignment is unchanged.
 */
export function computeMass(
  v: number,
  clauses: Clause[],
  assignment: Uint8Array,
): number {
  const base = countUnsat(clauses, assignment);
  assignment[v] = (assignment[v]! ^ 1) as 0 | 1;
  const flipped = countUnsat(clauses, assignment);
  assignment[v] = (assignment[v]! ^ 1) as 0 | 1;
  return flipped - base;
}

/**
 * Pseudo-random sample of `k` distinct indices from [0, n). Uses the
 * provided rng so the snapshot is deterministic when callers want
 * reproducibility (the biomimetic loop is itself deterministically
 * seeded).
 */
function sampleIndices(n: number, k: number, rng: () => number): number[] {
  const target = Math.min(k, n);
  if (target === n) {
    const all: number[] = [];
    for (let i = 0; i < n; i++) all.push(i);
    return all;
  }
  // Reservoir sampling — O(n) and unbiased, no allocations beyond
  // the reservoir itself.
  const out: number[] = [];
  for (let i = 0; i < target; i++) out.push(i);
  for (let i = target; i < n; i++) {
    const j = Math.floor(rng() * (i + 1));
    if (j < target) out[j] = i;
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  // Sample variance (matches Python's statistics.variance).
  return s / (xs.length - 1);
}

/**
 * Compute the Higgs field state at a single timestep. Samples
 * `sampleSize` variables for efficiency on large instances.
 */
export function computeFieldSnapshot(
  nVars: number,
  clauses: Clause[],
  assignment: Uint8Array,
  step: number,
  unsat: number,
  sampleSize: number,
  rng: () => number,
): HiggsSnapshot {
  const sample = sampleIndices(nVars, sampleSize, rng);
  const masses: number[] = sample.map((v) =>
    computeMass(v, clauses, assignment),
  );
  const n = masses.length;

  const fieldStrength = mean(masses);
  const fieldVariance = variance(masses);

  // orderParameter mirrors the Python: variance / (|mean| + ε), but
  // when mean is essentially zero we fall back to pure variance so a
  // wildly variable but balanced field still registers structure.
  let orderParameter: number;
  if (Math.abs(fieldStrength) > 1e-9) {
    orderParameter = fieldVariance / (Math.abs(fieldStrength) + 1e-9);
  } else {
    orderParameter = fieldVariance;
  }

  let massMin = masses[0]!;
  let massMax = masses[0]!;
  let heavyNeg = 0;
  let neutral = 0;
  let heavyPos = 0;
  for (const m of masses) {
    if (m < massMin) massMin = m;
    if (m > massMax) massMax = m;
    if (m < -1) heavyNeg++;
    else if (m > 1) heavyPos++;
    else neutral++;
  }

  const round4 = (x: number): number => Math.round(x * 10000) / 10000;
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;

  return {
    step,
    unsat,
    fieldStrength: round4(fieldStrength),
    fieldVariance: round4(fieldVariance),
    orderParameter: round4(orderParameter),
    massMin,
    massMax,
    heavyNegFrac: round3(heavyNeg / n),
    neutralFrac: round3(neutral / n),
    heavyPosFrac: round3(heavyPos / n),
  };
}

// ===== Logger — plug into the solve loop =====

export interface HiggsLoggerOptions {
  /** Record a snapshot every N solver steps (default 10). */
  logInterval?: number;
  /** How many variables to sample per snapshot (default 30). */
  sampleSize?: number;
}

/**
 * Stateful logger driven by the solve loop. Call `step()` every outer
 * iteration; call `finalize()` at the end with the run outcome.
 */
export class HiggsLogger {
  private readonly nVars: number;
  private readonly clauses: Clause[];
  private readonly logInterval: number;
  private readonly sampleSize: number;
  private readonly rng: () => number;

  private stepIdx = 0;
  private snapshots: HiggsSnapshot[] = [];

  constructor(
    nVars: number,
    clauses: Clause[],
    rng: () => number,
    opts: HiggsLoggerOptions = {},
  ) {
    this.nVars = nVars;
    this.clauses = clauses;
    this.rng = rng;
    this.logInterval = Math.max(1, opts.logInterval ?? 10);
    this.sampleSize = Math.max(1, opts.sampleSize ?? 30);
  }

  /**
   * Call from the solve loop with the current assignment + unsat count.
   * Returns the captured snapshot when one was taken this step (every
   * `logInterval` steps), otherwise `null`. Returning the snapshot lets
   * downstream consumers like the PhaseGate consume the OP value the
   * moment it's computed, without having to reach into `capturedSnapshots`
   * and de-dupe.
   */
  step(assignment: Uint8Array, currentUnsat: number): HiggsSnapshot | null {
    this.stepIdx++;
    if (this.stepIdx % this.logInterval !== 0) return null;
    const snap = computeFieldSnapshot(
      this.nVars,
      this.clauses,
      assignment,
      this.stepIdx,
      currentUnsat,
      this.sampleSize,
      this.rng,
    );
    this.snapshots.push(snap);
    return snap;
  }

  /** Call once when the solve loop exits. */
  finalize(outcome: HiggsOutcome, finalUnsat: number): HiggsRun {
    return {
      outcome,
      finalUnsat,
      totalSteps: this.stepIdx,
      snapshots: this.snapshots.slice(),
    };
  }

  /** Inspection helpers (mostly for tests / debugging). */
  get capturedSnapshots(): readonly HiggsSnapshot[] {
    return this.snapshots;
  }

  get configuredInterval(): number {
    return this.logInterval;
  }

  get configuredSampleSize(): number {
    return this.sampleSize;
  }
}

/**
 * Map a final unsat count to one of the three outcome buckets used by
 * the analyzer. Threshold matches the Python integration template:
 * `solved` when fully satisfied, `stuck_hard` when more than 3 clauses
 * remain unsatisfied, `stuck_soft` otherwise.
 */
export function classifyOutcome(
  solved: boolean,
  finalUnsat: number,
): HiggsOutcome {
  if (solved || finalUnsat === 0) return "solved";
  return finalUnsat > 3 ? "stuck_hard" : "stuck_soft";
}

// ===== Cross-run analyzer =====

/**
 * Single row consumed by the analyzer — the per-snapshot trajectory plus
 * its outcome label. Matches what `ephemeroi_higgs_runs` stores.
 */
export interface AnalyzerInput {
  outcome: HiggsOutcome;
  finalUnsat: number;
  totalSteps: number;
  snapshots: HiggsSnapshot[];
}

export interface OutcomeProfilePoint {
  step: number;
  meanOrderParameter: number;
  meanFieldStrength: number;
  sampleCount: number;
}

export interface TransitionDetectionEntry {
  outcome: HiggsOutcome;
  /** Mean step at which order parameter first crossed `threshold`. */
  meanCrossingStep: number | null;
  /** How many runs in this bucket actually crossed. */
  count: number;
  threshold: number;
}

export interface DivergencePoint {
  step: number;
  /** |meanOP(solved) - meanOP(stuck_hard)| at this step. */
  gap: number;
}

export interface HiggsAnalysisReport {
  totalRuns: number;
  byOutcome: Record<HiggsOutcome, number>;
  /** OP threshold used for transition detection (matches Python: 2.0). */
  opThreshold: number;
  /** Mean OP / FS profile per outcome, indexed by snapshot step. */
  profiles: Record<HiggsOutcome, OutcomeProfilePoint[]>;
  /** First-crossing-step statistics per outcome. */
  transitionDetection: TransitionDetectionEntry[];
  /** |OP_solved - OP_stuck_hard| at each common step. */
  divergence: DivergencePoint[];
  /** Largest divergence point if computable. */
  maxDivergence: DivergencePoint | null;
  /** First step where divergence > 1.0 — earliest practical signal. */
  earlyWarningStep: number | null;
}

const OP_TRANSITION_THRESHOLD = 2.0;

/**
 * Build cross-run profiles + transition statistics + early-warning
 * signal. Pure function over a list of run logs; no I/O.
 */
export function analyzeHiggsRuns(runs: AnalyzerInput[]): HiggsAnalysisReport {
  const byOutcome: Record<HiggsOutcome, AnalyzerInput[]> = {
    solved: [],
    stuck_soft: [],
    stuck_hard: [],
  };
  for (const r of runs) byOutcome[r.outcome].push(r);

  // ── Profiles: per outcome, per step, mean OP / FS across runs ──
  const profiles: Record<HiggsOutcome, OutcomeProfilePoint[]> = {
    solved: [],
    stuck_soft: [],
    stuck_hard: [],
  };

  const profileMap = (logs: AnalyzerInput[]): OutcomeProfilePoint[] => {
    const opByStep = new Map<number, number[]>();
    const fsByStep = new Map<number, number[]>();
    for (const log of logs) {
      for (const snap of log.snapshots) {
        let opArr = opByStep.get(snap.step);
        if (!opArr) {
          opArr = [];
          opByStep.set(snap.step, opArr);
        }
        opArr.push(snap.orderParameter);
        let fsArr = fsByStep.get(snap.step);
        if (!fsArr) {
          fsArr = [];
          fsByStep.set(snap.step, fsArr);
        }
        fsArr.push(snap.fieldStrength);
      }
    }
    const steps = Array.from(opByStep.keys()).sort((a, b) => a - b);
    return steps.map((step) => {
      const ops = opByStep.get(step)!;
      const fss = fsByStep.get(step)!;
      return {
        step,
        meanOrderParameter: round4(mean(ops)),
        meanFieldStrength: round4(mean(fss)),
        sampleCount: ops.length,
      };
    });
  };

  for (const outcome of ["solved", "stuck_soft", "stuck_hard"] as const) {
    profiles[outcome] = profileMap(byOutcome[outcome]);
  }

  // ── Transition detection: first step OP crosses threshold ──
  const transitionDetection: TransitionDetectionEntry[] = (
    ["solved", "stuck_soft", "stuck_hard"] as const
  ).map((outcome) => {
    const crossings: number[] = [];
    for (const log of byOutcome[outcome]) {
      const cross = log.snapshots.find(
        (s) => s.orderParameter > OP_TRANSITION_THRESHOLD,
      );
      if (cross) crossings.push(cross.step);
    }
    return {
      outcome,
      meanCrossingStep: crossings.length > 0 ? round1(mean(crossings)) : null,
      count: crossings.length,
      threshold: OP_TRANSITION_THRESHOLD,
    };
  });

  // ── Divergence between solved and stuck_hard profiles ──
  const solvedByStep = new Map(
    profiles.solved.map((p) => [p.step, p.meanOrderParameter] as const),
  );
  const stuckHardByStep = new Map(
    profiles.stuck_hard.map((p) => [p.step, p.meanOrderParameter] as const),
  );
  const commonSteps = Array.from(solvedByStep.keys())
    .filter((s) => stuckHardByStep.has(s))
    .sort((a, b) => a - b);

  const divergence: DivergencePoint[] = commonSteps.map((step) => ({
    step,
    gap: round4(
      Math.abs(solvedByStep.get(step)! - stuckHardByStep.get(step)!),
    ),
  }));

  let maxDivergence: DivergencePoint | null = null;
  for (const d of divergence) {
    if (!maxDivergence || d.gap > maxDivergence.gap) maxDivergence = d;
  }
  const earlyWarningStep = divergence.find((d) => d.gap > 1.0)?.step ?? null;

  return {
    totalRuns: runs.length,
    byOutcome: {
      solved: byOutcome.solved.length,
      stuck_soft: byOutcome.stuck_soft.length,
      stuck_hard: byOutcome.stuck_hard.length,
    },
    opThreshold: OP_TRANSITION_THRESHOLD,
    profiles,
    transitionDetection,
    divergence,
    maxDivergence,
    earlyWarningStep,
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
