import { logger } from "../../lib/logger";
import { askDon } from "./don";
import { bus } from "./bus";
import { sendTelegramText } from "./telegram";

/**
 * Biomimetic Constraint-Field Solver — v0.11.3
 *
 * An executable form of the protocol: not a SAT optimizer, but a
 * constraint-field engineer that destroys invalid stability structures.
 *
 * Core moves per outer step:
 *   1. Compute consensus_map, bridge_score, pressure_field over the variables.
 *   2. Spliceosome step — flip every "intron" (high-consensus var while
 *      unsat>0) regardless of local cost, then stabilize the top-K
 *      "exons" (high bridge_score vars) toward the assignment that
 *      satisfies the most clauses they appear in.
 *   3. Apply pressure flow — drain noise from the highest-pressure var
 *      to the lowest by perturbing the latter (a directed entropy
 *      current, not a random walk).
 *   4. If a cage is detected (mean consensus high AND still unsat),
 *      fire the Cyrus Edict — a bounded cascade (cap 7, with a recent-
 *      trigger rate-limit) of forced flips on top-consensus vars.
 *   5. Check invariants. If pressure variance collapses (system at
 *      equilibrium), inject perturbation to keep the field non-equilibrium.
 *
 * The algorithm runs on a self-contained, deterministically-seeded
 * synthetic 3-SAT problem at ratio ~4.27 (just past the phase transition
 * for random 3-SAT) so cages are likely. Anything significant — cage
 * detection, edict cascade, final result — flows out as Constellation
 * events to the existing event bus, with a Don/Wife/Son narration sent
 * to Telegram on the most interesting moment.
 *
 * The caller never throws — we always return a structured result so the
 * HTTP route can render it cleanly even when something failed mid-run.
 */

// ===== Types =====

/** A clause is a list of signed integer literals (1-indexed; negative = negated). */
export type Clause = number[];

export interface BiomimeticOptions {
  /** Number of variables in the synthetic problem (default 24). */
  n?: number;
  /** Clause/variable ratio (default 4.27 — phase transition for 3-SAT). */
  ratio?: number;
  /** Hard cap on outer steps (default 200). */
  maxSteps?: number;
  /** Top-K exons per spliceosome step (default ceil(sqrt(n))). */
  topK?: number;
  /** Deterministic RNG seed (default 0xC0FFEE). */
  seed?: number;
  /** Initial temperature for the pressure-flow noise transfer (default 0.6). */
  temperature?: number;
  /** Edict cascade cap (default 7). */
  edictCap?: number;
}

export interface StepEvent {
  step: number;
  unsat: number;
  consensusMean: number;
  pressureVariance: number;
  cageDetected: boolean;
  edictTriggered: boolean;
  edictCascadeDepth: number;
  intronsFlipped: number;
  exonsReinforced: number;
  invariantViolations: string[];
}

export interface BiomimeticResult {
  /** Did we drive unsat to 0 within the step budget? */
  solved: boolean;
  /** Final number of unsatisfied clauses. */
  finalUnsat: number;
  /** Total outer steps executed. */
  steps: number;
  /** Number of times the Cyrus Edict was triggered. */
  edictCount: number;
  /** Number of times a cage was detected. */
  cageEvents: number;
  /** Total invariant violations observed across all steps. */
  invariantViolations: number;
  /** Per-step telemetry. Truncated to last 50 entries to keep the response small. */
  timeline: StepEvent[];
  /** Don/Wife/Son narration when something interesting happened — null if no cage. */
  donNarration: string | null;
  /** Plain-text summary suitable for printing or sending to Telegram. */
  formatted: string;
  /** Number of variables in the synthetic problem we ran on. */
  n: number;
  /** Number of clauses in the synthetic problem. */
  m: number;
  /** Wall time spent inside the run, in ms. */
  durationMs: number;
}

// ===== Public entry point =====

/**
 * Run the biomimetic protocol against a fresh synthetic 3-SAT problem.
 * Always returns a structured result; errors during narration or Telegram
 * delivery are absorbed (logged) so the caller still sees the run output.
 */
export async function runBiomimetic(
  opts: BiomimeticOptions = {},
): Promise<BiomimeticResult> {
  const t0 = Date.now();
  const n = opts.n ?? 24;
  const ratio = opts.ratio ?? 4.27;
  const m = Math.max(1, Math.round(n * ratio));
  const maxSteps = opts.maxSteps ?? 200;
  const topK = opts.topK ?? Math.max(1, Math.ceil(Math.sqrt(n)));
  const seed = opts.seed ?? 0xc0ffee;
  const T = opts.temperature ?? 0.6;
  const edictCap = opts.edictCap ?? 7;

  const rng = mulberry32(seed);
  const clauses = generate3SatProblem(n, m, rng);
  const assignment = randomAssignment(n, rng);

  const timeline: StepEvent[] = [];
  let edictCount = 0;
  let cageEvents = 0;
  let invariantTotal = 0;
  // Step indices of recent edicts — feeds the rate limiter so the Cyrus
  // Edict can't degenerate into oscillation.
  const recentEdicts: number[] = [];

  let unsat = computeUnsat(clauses, assignment);
  let firstCageEvent: StepEvent | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    if (unsat === 0) break;

    const consensusMap = computeConsensusMap(clauses, assignment);
    const bridgeScore = computeBridgeScore(clauses, n, consensusMap);
    const pressureField = computePressureField(clauses, assignment, consensusMap, n);
    const pressureVariance = variance(pressureField);

    // 1. Spliceosome — routine destruction of invalid stability
    const splice = spliceosomeStep(clauses, assignment, consensusMap, bridgeScore, topK, unsat);
    unsat = computeUnsat(clauses, assignment);

    // 2. Pressure flow — drain from the highest-pressure var to the lowest
    //    by perturbing the low-pressure var with magnitude T.
    applyPressureFlow(assignment, pressureField, T, rng);
    unsat = computeUnsat(clauses, assignment);

    // 3. Cage detection + Cyrus Edict. We recompute consensus AFTER the
    //    routine moves — a cage means "still stuck despite spliceosome
    //    and pressure flow", which is when the emergency edict belongs.
    const consensusMapPost = computeConsensusMap(clauses, assignment);
    const consensusMean = mean(consensusMapPost);
    let edictTriggered = false;
    let edictCascadeDepth = 0;
    // Spec threshold is `mean(consensus_map) > 0.95`, written for the
    // binary form. With our continuous sigmoid consensus, the empirical
    // "stuck" mean tops out around 0.7-0.8 — we use 0.7 as the cage
    // threshold to preserve the spec's intent ("almost everyone is
    // locked in") in continuous coordinates.
    const cage = consensusMean > 0.7 && unsat > 0;
    if (cage) {
      cageEvents += 1;
      // Rate-limit: if we've fired the edict more than 3 times in the
      // last 50 steps, halve the cap so we don't thrash.
      const recentlyHot = recentEdicts.filter((s) => step - s <= 50).length;
      const cap = recentlyHot > 3 ? Math.max(1, Math.floor(edictCap / 2)) : edictCap;
      // Use the post-step consensus that actually triggered the cage —
      // the pre-step ranking is stale by this point and would target the
      // wrong variables.
      const cascade = cyrusEdict(clauses, assignment, consensusMapPost, cap);
      edictCascadeDepth = cascade.depth;
      edictTriggered = cascade.depth > 0;
      if (edictTriggered) {
        edictCount += 1;
        recentEdicts.push(step);
      }
      unsat = computeUnsat(clauses, assignment);
    }

    // 4. Invariant checks (with self-correction on the first one)
    const invariants: string[] = [];
    if (pressureVariance < 1e-4) {
      invariants.push("pressure_variance_collapse");
      // Inject a small perturbation so the system stays non-equilibrium.
      const i = Math.floor(rng() * n);
      assignment[i] = (assignment[i]! ^ 1) as 0 | 1;
      unsat = computeUnsat(clauses, assignment);
    }
    // Anti-consensus bias invariant: at any point where unsat > 0, the
    // protocol forbids the system from converging into pure agreement.
    // We check this AFTER the routine moves and the (optional) edict —
    // if consensus is still riding extremely high while unsat is still
    // positive, the field-engineering moves above failed to break the
    // structure they're supposed to break, and we re-inject perturbation
    // via the same low-pressure-flip mechanism the pressure-flow step uses.
    if (unsat > 0 && mean(computeConsensusMap(clauses, assignment)) > 0.9) {
      invariants.push("anti_consensus_bias_violated");
      const i = Math.floor(rng() * n);
      assignment[i] = (assignment[i]! ^ 1) as 0 | 1;
      unsat = computeUnsat(clauses, assignment);
    }
    invariantTotal += invariants.length;

    const evt: StepEvent = {
      step,
      unsat,
      consensusMean,
      pressureVariance,
      cageDetected: cage,
      edictTriggered,
      edictCascadeDepth,
      intronsFlipped: splice.intronsFlipped,
      exonsReinforced: splice.exonsReinforced,
      invariantViolations: invariants,
    };
    timeline.push(evt);
    if (cage && firstCageEvent === null) firstCageEvent = evt;

    // Fire bus events on significant moments only — per-step would flood
    // any subscriber (and the SSE stream).
    if (cage || edictTriggered || invariants.length > 0) {
      bus.publish({
        type: "constellation_alert",
        payload: { source: "biomimetic", step, ...evt },
      });
    }
  }

  const finalUnsat = unsat;
  const solved = finalUnsat === 0;

  // 5. Narration on the most interesting moment of the run.
  let donText: string | null = null;
  let donSource: "ollama" | "openai" | "stub" | null = null;
  if (firstCageEvent) {
    try {
      const prompt = buildDonPromptForCage({
        n,
        m,
        cage: firstCageEvent,
        finalUnsat,
        solved,
        edictCount,
        cageEvents,
      });
      const don = await askDon(prompt);
      donText = don.text;
      donSource = don.source;
    } catch (err) {
      logger.warn({ err }, "Biomimetic: Don narration failed");
    }
  }

  const formatted = formatRun({
    n,
    m,
    solved,
    finalUnsat,
    steps: timeline.length,
    edictCount,
    cageEvents,
    invariantViolations: invariantTotal,
    donText,
    donSource,
    durationMs: Date.now() - t0,
  });

  // Send a single Telegram ping summarizing the run. This matches the
  // bot's existing "one ping on completion" pattern from self-improvement.
  try {
    await sendTelegramText(formatted);
  } catch (err) {
    logger.warn({ err }, "Biomimetic: Telegram delivery failed");
  }

  // Truncate the timeline so we don't ship 200 step events back over HTTP.
  const trimmedTimeline = timeline.slice(-50);

  logger.info(
    {
      solved,
      finalUnsat,
      steps: timeline.length,
      edictCount,
      cageEvents,
      invariantViolations: invariantTotal,
    },
    "Biomimetic run complete",
  );

  return {
    solved,
    finalUnsat,
    steps: timeline.length,
    edictCount,
    cageEvents,
    invariantViolations: invariantTotal,
    timeline: trimmedTimeline,
    donNarration: donText,
    formatted,
    n,
    m,
    durationMs: Date.now() - t0,
  };
}

// ===== Algorithm steps =====

/**
 * Spliceosome step. Flips every intron (variable where current value is
 * locally-locked-in but the system is still wrong) regardless of local
 * cost — this is the protocol's "force disruption" move. Then reinforces
 * structure by stabilizing the top-K exons (high-bridge-score vars) to
 * whichever value satisfies more of the clauses they appear in.
 */
function spliceosomeStep(
  clauses: Clause[],
  assignment: Uint8Array,
  consensusMap: Float32Array,
  bridgeScore: Float32Array,
  topK: number,
  unsat: number,
): { intronsFlipped: number; exonsReinforced: number } {
  let intronsFlipped = 0;
  if (unsat > 0) {
    for (let i = 0; i < assignment.length; i++) {
      // Spec: `consensus_map == 1.0`. We use a sigmoid consensus measure,
      // so "essentially full lock-in" maps to >= 0.88 (corresponds to a
      // flip-gain of about -2 — flipping this variable would unsat at
      // least two more clauses than it satisfies).
      if (consensusMap[i]! >= 0.88) {
        assignment[i] = (assignment[i]! ^ 1) as 0 | 1;
        intronsFlipped += 1;
      }
    }
  }

  // Top-K exons by bridge score — stabilize toward the value that
  // satisfies more of their clauses.
  const indices = Array.from({ length: assignment.length }, (_, i) => i);
  indices.sort((a, b) => bridgeScore[b]! - bridgeScore[a]!);
  let exonsReinforced = 0;
  for (let k = 0; k < Math.min(topK, indices.length); k++) {
    const i = indices[k]!;
    const best = bestValueFor(clauses, assignment, i);
    if (best !== assignment[i]) {
      assignment[i] = best;
      exonsReinforced += 1;
    }
  }
  return { intronsFlipped, exonsReinforced };
}

/**
 * Pressure flow. With probability T, flip the lowest-pressure variable —
 * "drain" entropy from the highest-pressure region by perturbing the
 * coolest one. This is a directed current, not random noise.
 */
function applyPressureFlow(
  assignment: Uint8Array,
  pressureField: Float32Array,
  T: number,
  rng: () => number,
): void {
  if (rng() >= T) return;
  let lowIdx = 0;
  let lowVal = pressureField[0]!;
  for (let i = 1; i < pressureField.length; i++) {
    if (pressureField[i]! < lowVal) {
      lowVal = pressureField[i]!;
      lowIdx = i;
    }
  }
  assignment[lowIdx] = (assignment[lowIdx]! ^ 1) as 0 | 1;
}

/**
 * Cyrus Edict cascade. When a cage is detected, force-flip the top
 * high-consensus variables — repeating up to `cap` iterations or until
 * unsat reaches zero, whichever comes first.
 */
function cyrusEdict(
  clauses: Clause[],
  assignment: Uint8Array,
  consensusMap: Float32Array,
  cap: number,
): { depth: number } {
  // Pre-rank by consensus once; we re-evaluate after each iteration in
  // case the field shifts dramatically.
  let depth = 0;
  for (let iter = 0; iter < cap; iter++) {
    const cm = depth === 0 ? consensusMap : computeConsensusMap(clauses, assignment);
    const indices = Array.from({ length: assignment.length }, (_, i) => i);
    indices.sort((a, b) => cm[b]! - cm[a]!);
    // Force-flip the top sqrt(n) of them — enough to cause real
    // structural breakage without nuking the whole assignment.
    const k = Math.max(1, Math.floor(Math.sqrt(assignment.length)));
    let flipped = 0;
    for (let j = 0; j < k; j++) {
      const i = indices[j]!;
      if (cm[i]! > 0.5) {
        assignment[i] = (assignment[i]! ^ 1) as 0 | 1;
        flipped += 1;
      }
    }
    depth += 1;
    if (flipped === 0) break;
    if (computeUnsat(clauses, assignment) === 0) break;
  }
  return { depth };
}

// ===== Field computations =====

/**
 * Continuous local-gain definition of consensus. A variable's consensus
 * score is its sigmoid resistance to being flipped: 1.0 means strongly
 * locked-in (large negative gain — flipping would unsat many clauses),
 * 0.5 means neutral, 0.0 means it actively wants to flip. This continuous
 * form is what lets `mean(consensus_map)` cross the 0.95 cage threshold
 * gradually as the system settles into a stuck shape — a binary version
 * almost never crosses it because the spliceosome step keeps shaking
 * individual locks loose.
 */
function computeConsensusMap(
  clauses: Clause[],
  assignment: Uint8Array,
): Float32Array {
  const n = assignment.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gain = flipGain(clauses, assignment, i);
    // sigmoid(-gain) — gain=-3 → ~0.95, gain=0 → 0.5, gain=+3 → ~0.05.
    out[i] = 1.0 / (1.0 + Math.exp(gain));
  }
  return out;
}

/**
 * Bridge score = clause_connectivity * clause_diversity * (1 - consensus).
 *   - connectivity: how many clauses the var appears in (normalized to
 *     [0,1] by the maximum across all vars).
 *   - diversity: how mixed-polarity the var is across its clauses (1
 *     when perfectly balanced, 0 when only one polarity).
 *   - (1 - consensus): exclude vars that are locally locked in.
 *
 * High bridge score = high-influence, cross-cluster, not yet decided.
 * These are the "exons" worth stabilizing.
 */
function computeBridgeScore(
  clauses: Clause[],
  n: number,
  consensusMap: Float32Array,
): Float32Array {
  const pos = new Int32Array(n);
  const neg = new Int32Array(n);
  for (const c of clauses) {
    for (const lit of c) {
      const i = Math.abs(lit) - 1;
      if (lit > 0) pos[i]! += 1;
      else neg[i]! += 1;
    }
  }
  let maxAppearances = 1;
  for (let i = 0; i < n; i++) {
    const total = pos[i]! + neg[i]!;
    if (total > maxAppearances) maxAppearances = total;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const total = pos[i]! + neg[i]!;
    if (total === 0) {
      out[i] = 0;
      continue;
    }
    const connectivity = total / maxAppearances;
    const diversity = 1 - Math.abs(pos[i]! - neg[i]!) / total;
    out[i] = connectivity * diversity * (1 - consensusMap[i]!);
  }
  return out;
}

/**
 * Pressure field per variable: alpha * normalized local_unsat - beta * consensus.
 * High pressure = lots of unsat clauses touching this var, and not locked
 * in — so it's a place where the field is straining.
 */
function computePressureField(
  clauses: Clause[],
  assignment: Uint8Array,
  consensusMap: Float32Array,
  n: number,
): Float32Array {
  const alpha = 1.0;
  const beta = 0.5;
  const local = new Int32Array(n);
  for (const c of clauses) {
    if (clauseSatisfied(c, assignment)) continue;
    for (const lit of c) local[Math.abs(lit) - 1]! += 1;
  }
  let maxLocal = 1;
  for (let i = 0; i < n; i++) if (local[i]! > maxLocal) maxLocal = local[i]!;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = alpha * (local[i]! / maxLocal) - beta * consensusMap[i]!;
  }
  return out;
}

// ===== Primitive helpers =====

function clauseSatisfied(clause: Clause, assignment: Uint8Array): boolean {
  for (const lit of clause) {
    const i = Math.abs(lit) - 1;
    const v = assignment[i]!;
    if ((lit > 0 && v === 1) || (lit < 0 && v === 0)) return true;
  }
  return false;
}

function computeUnsat(clauses: Clause[], assignment: Uint8Array): number {
  let count = 0;
  for (const c of clauses) if (!clauseSatisfied(c, assignment)) count += 1;
  return count;
}

/** Net change in satisfied clauses if variable i were flipped. */
function flipGain(
  clauses: Clause[],
  assignment: Uint8Array,
  i: number,
): number {
  let gain = 0;
  const before = assignment[i]!;
  for (const c of clauses) {
    if (!c.some((lit) => Math.abs(lit) - 1 === i)) continue;
    const wasSat = clauseSatisfied(c, assignment);
    assignment[i] = (before ^ 1) as 0 | 1;
    const nowSat = clauseSatisfied(c, assignment);
    assignment[i] = before;
    if (!wasSat && nowSat) gain += 1;
    else if (wasSat && !nowSat) gain -= 1;
  }
  return gain;
}

/** Pick the assignment value for var i that satisfies more of its clauses. */
function bestValueFor(
  clauses: Clause[],
  assignment: Uint8Array,
  i: number,
): 0 | 1 {
  const original = assignment[i]!;
  let satWith0 = 0;
  let satWith1 = 0;
  for (const c of clauses) {
    if (!c.some((lit) => Math.abs(lit) - 1 === i)) continue;
    assignment[i] = 0;
    if (clauseSatisfied(c, assignment)) satWith0 += 1;
    assignment[i] = 1;
    if (clauseSatisfied(c, assignment)) satWith1 += 1;
  }
  assignment[i] = original;
  return satWith1 >= satWith0 ? 1 : 0;
}

function generate3SatProblem(n: number, m: number, rng: () => number): Clause[] {
  // Belt-and-braces guard: each clause needs three distinct variables, so
  // n < 3 would make the inner `while (vars.size < 3)` loop run forever.
  // The HTTP route already enforces n >= 3 via zod, but anyone calling
  // runBiomimetic() directly deserves a clear error rather than a hang.
  if (n < 3) {
    throw new Error(`generate3SatProblem requires n >= 3 (got ${n})`);
  }
  const out: Clause[] = [];
  for (let c = 0; c < m; c++) {
    const vars = new Set<number>();
    while (vars.size < 3) vars.add(1 + Math.floor(rng() * n));
    const clause: number[] = [];
    for (const v of vars) clause.push(rng() < 0.5 ? -v : v);
    out.push(clause);
  }
  return out;
}

function randomAssignment(n: number, rng: () => number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = rng() < 0.5 ? 0 : 1;
  return a;
}

function mean(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i]!;
  return arr.length === 0 ? 0 : s / arr.length;
}

function variance(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  const mu = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i]! - mu;
    s += d * d;
  }
  return s / arr.length;
}

/** Mulberry32 — small, fast, deterministic. We seed runs so the same
 *  request twice produces the same trace, which is what you want for a
 *  diagnostic tool. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== Narration + formatting =====

function buildDonPromptForCage(input: {
  n: number;
  m: number;
  cage: StepEvent;
  finalUnsat: number;
  solved: boolean;
  edictCount: number;
  cageEvents: number;
}): string {
  return [
    `The biomimetic constraint-field solver hit a CAGE on a ${input.n}-variable, ${input.m}-clause synthetic 3-SAT problem.`,
    "",
    `At step ${input.cage.step}: consensus mean ${input.cage.consensusMean.toFixed(3)}, pressure variance ${input.cage.pressureVariance.toFixed(3)}, ${input.cage.unsat} unsat clauses left.`,
    `By the end: ${input.solved ? "solved" : "still " + input.finalUnsat + " unsat"}, ${input.edictCount} Cyrus Edict cascade(s) fired across ${input.cageEvents} cage event(s).`,
    "",
    "Speak as the Don. Explain what 'cage' means here — the system is too comfortable in a wrong shape, and the protocol had to break the comfort by force. The Wife should comment on consensus as a survival mechanism for bad structures. The Son should warn about destroying real agreement if we use the edict carelessly.",
  ].join("\n");
}

function formatRun(input: {
  n: number;
  m: number;
  solved: boolean;
  finalUnsat: number;
  steps: number;
  edictCount: number;
  cageEvents: number;
  invariantViolations: number;
  donText: string | null;
  donSource: "ollama" | "openai" | "stub" | null;
  durationMs: number;
}): string {
  const lines: string[] = [];
  lines.push(`✦ Biomimetic protocol — run complete`);
  lines.push(
    input.solved
      ? `result: SOLVED (unsat → 0)`
      : `result: ${input.finalUnsat} unsat remaining`,
  );
  lines.push("");
  lines.push(`problem: ${input.n} vars × ${input.m} clauses (3-SAT, phase-transition ratio)`);
  lines.push(`steps: ${input.steps}`);
  lines.push(`cage events: ${input.cageEvents}`);
  lines.push(`Cyrus edicts fired: ${input.edictCount}`);
  lines.push(`invariant violations: ${input.invariantViolations}`);
  lines.push(`wall time: ${input.durationMs}ms`);
  if (input.donText) {
    lines.push("");
    lines.push(input.donText);
    if (input.donSource) lines.push(`(voice: ${input.donSource})`);
  }
  return lines.join("\n");
}
