/**
 * OP-Triggered Adversarial Restart.
 *
 * When the Higgs order parameter (OP) crosses a high threshold (default 2)
 * very early in a run (default before step 15), the field has locked into
 * a structured-but-wrong shape — the cross-run analyzer's "stuck_hard"
 * signature. Continuing the inner loop just burns steps refining a doomed
 * trajectory.
 *
 * Instead, we shake the assignment adversarially:
 *   1. Sample current variable masses (Δ unsat on flip — the same metric
 *      the Higgs field is built on).
 *   2. Identify the top-K heaviest variables — highest positive mass.
 *      These are the cage walls: flipping them hurts the most precisely
 *      because clauses have crystallized around their current value.
 *   3. Force those K variables to their opposite values.
 *   4. Re-randomize every other variable.
 *   5. The outer loop then continues from step+1 with the new assignment;
 *      the PhaseGate is reset so a fresh OP trajectory is observed.
 *
 * Bounded by `maxRestarts` so a pathological problem can't trigger
 * indefinitely. Off-band from the solver: the guard never throws into
 * the loop and never mutates anything outside the assignment.
 */

import { computeMass, type HiggsSnapshot } from "./higgs";
import type { Clause } from "./biomimetic";

export interface AdversarialRestartOptions {
  /**
   * OP value above which a restart is considered. Matches the cross-run
   * analyzer's transition threshold so the restart fires on the same
   * "field has crystallized" signature the analyzer flags.
   * Default 2.0.
   */
  opThreshold?: number;
  /**
   * Solver-step ceiling for restart consideration. Restarts only fire
   * when the threshold crossing happens at or before this step — the
   * whole point is to abandon doomed trajectories *early*, not to
   * yo-yo a mid-run trajectory that's already produced useful structure.
   * Default 15.
   */
  beforeStep?: number;
  /**
   * How many of the heaviest variables to force-flip on each restart.
   * Defaults to `max(1, ceil(sqrt(n)))` — enough to break the cage's
   * structural backbone without nuking the entire assignment.
   */
  topK?: number;
  /**
   * Hard cap on restarts per run. Prevents pathological instances from
   * looping forever. Default 3.
   */
  maxRestarts?: number;
}

export interface AdversarialRestartEvent {
  /** Solver step at which the restart fired. */
  step: number;
  /** OP value that tripped the guard. */
  orderParameter: number;
  /**
   * 1-indexed variable IDs that were force-flipped (the cage walls).
   * Stored for telemetry / replay; the solver itself doesn't read this back.
   */
  flippedHeavies: number[];
  /** How many restarts have happened in this run, including this one. */
  restartCount: number;
}

/**
 * Guard + executor for adversarial restarts. Stateful — one instance
 * per biomimetic run.
 */
export class AdversarialRestartGuard {
  private readonly opThreshold: number;
  private readonly beforeStep: number;
  private readonly topK: number;
  private readonly maxRestarts: number;
  private restartCount = 0;
  private readonly events: AdversarialRestartEvent[] = [];

  constructor(nVars: number, opts: AdversarialRestartOptions = {}) {
    this.opThreshold = opts.opThreshold ?? 2.0;
    this.beforeStep = Math.max(1, opts.beforeStep ?? 15);
    this.topK = Math.max(
      1,
      Math.min(nVars, opts.topK ?? Math.ceil(Math.sqrt(nVars))),
    );
    this.maxRestarts = Math.max(0, opts.maxRestarts ?? 3);
  }

  /**
   * Decide whether a restart should fire given the latest snapshot.
   * Returns false if Higgs gave us nothing this tick, the OP is below
   * threshold, we're past the early-restart window, or the per-run cap
   * is exhausted.
   */
  shouldRestart(snap: HiggsSnapshot | null, step: number): boolean {
    if (snap === null) return false;
    if (this.restartCount >= this.maxRestarts) return false;
    if (step > this.beforeStep) return false;
    return snap.orderParameter > this.opThreshold;
  }

  /**
   * Execute the restart: force-flip the K heaviest variables, randomize
   * the rest. Returns the event for telemetry.
   */
  applyRestart(
    snap: HiggsSnapshot,
    step: number,
    clauses: Clause[],
    assignment: Uint8Array,
    rng: () => number,
  ): AdversarialRestartEvent {
    const n = assignment.length;
    // Compute exact mass for every variable. n is small in practice
    // (default 24); we want exact ranking, not the sampled ranking the
    // Higgs logger uses for its per-step trajectory.
    const masses: { v: number; mass: number }[] = [];
    for (let v = 0; v < n; v++) {
      masses.push({ v, mass: computeMass(v, clauses, assignment) });
    }
    // Heaviest = largest positive mass — those are the cage walls.
    masses.sort((a, b) => b.mass - a.mass);
    const heavies = masses.slice(0, this.topK).map((m) => m.v);
    const heavySet = new Set(heavies);

    // 1. Force-flip the cage walls.
    for (const v of heavies) {
      assignment[v] = (assignment[v]! ^ 1) as 0 | 1;
    }
    // 2. Re-randomize everything else.
    for (let v = 0; v < n; v++) {
      if (heavySet.has(v)) continue;
      assignment[v] = rng() < 0.5 ? 0 : 1;
    }

    this.restartCount += 1;
    const event: AdversarialRestartEvent = {
      step,
      orderParameter: snap.orderParameter,
      flippedHeavies: heavies.map((v) => v + 1).sort((a, b) => a - b),
      restartCount: this.restartCount,
    };
    this.events.push(event);
    return event;
  }

  get count(): number {
    return this.restartCount;
  }

  get history(): readonly AdversarialRestartEvent[] {
    return this.events;
  }
}
