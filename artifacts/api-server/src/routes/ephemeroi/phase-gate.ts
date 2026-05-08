/**
 * PhaseGate — symmetry-breaking gate that switches the biomimetic solver
 * between EXPLORE and PRECISION phases based on the Higgs order
 * parameter (OP) trajectory.
 *
 * Why OP slope and not OP value:
 *   - A rising OP means the field is *actively breaking symmetry* —
 *     structure is forming and the run is making progress toward a
 *     resolution. This is when PRECISION moves are productive.
 *   - A plateaued OP means the field has locked rigid (cage-like). High
 *     absolute OP with zero slope is *not* the same as breaking
 *     symmetry; it's the stuck-shape signature.
 *   - A falling OP means the broken phase is collapsing — either
 *     toward a solve or back into the symmetric basin. Either way,
 *     PRECISION is no longer the right mode.
 *
 * Behavior is symmetric per the user spec for sub-task #1:
 *   - Rising slope (> entry threshold) gates *entry* into PRECISION.
 *   - Plateau or falling slope (≤ exit threshold) forces *exit* back to
 *     EXPLORE.
 *
 * Hysteresis: entry threshold strictly greater than exit threshold so
 * we don't oscillate when slope hovers near zero.
 *
 * Other gating signals (stagnation, swarm, convergence, harmonic) are
 * referenced in the design notes but not yet implemented in the
 * biomimetic solver — see TODOs in `recordSignal`. The OP-slope path
 * is the load-bearing one for now.
 */

export type Phase = "EXPLORE" | "PRECISION";

/**
 * Auxiliary signals that downstream subsystems (BackboneDetector,
 * Splicer, FragmentGraph) will eventually feed into the gate. Recorded
 * for visibility but not consumed by the current decision logic.
 */
export type AuxSignal = "stagnation" | "swarm" | "convergence" | "harmonic";

export interface PhaseGateOptions {
  /**
   * How many recent OP samples participate in the slope estimate.
   * Window of 4 means we measure (latest - oldest) / 3 across the
   * last 4 snapshots. Default 4.
   */
  windowSize?: number;
  /**
   * OP-slope threshold for entering PRECISION. Slope strictly greater
   * than this value triggers entry. Default 0.1 (per snapshot tick).
   */
  entrySlope?: number;
  /**
   * OP-slope threshold for staying in PRECISION. Slope at or below
   * this value forces exit back to EXPLORE. Default 0.02.
   *
   * Must be < entrySlope to provide hysteresis.
   */
  exitSlope?: number;
}

export interface PhaseSnapshot {
  phase: Phase;
  /** Estimated OP slope per snapshot tick over the active window. */
  slope: number;
  /** Number of OP samples currently in the window (≤ windowSize). */
  windowFilled: number;
  /**
   * Why the gate is in the current phase. Useful for telemetry and
   * for the upcoming Splicer/FragmentGraph wiring.
   */
  reason: PhaseReason;
}

export type PhaseReason =
  | "initial"
  | "insufficient_samples"
  | "slope_rising_entered_precision"
  | "slope_plateau_exited_precision"
  | "slope_falling_exited_precision"
  | "slope_holding_precision"
  | "slope_holding_explore";

/**
 * PhaseGate is a small finite-state machine driven by a sliding window
 * of OP samples. Construct once per solver run; call `update(op)` each
 * time a fresh OP sample is available (i.e. when the HiggsLogger
 * actually captured a snapshot — between captures the gate is silent).
 */
export class PhaseGate {
  private readonly windowSize: number;
  private readonly entrySlope: number;
  private readonly exitSlope: number;

  private readonly window: number[] = [];
  private currentPhase: Phase = "EXPLORE";
  private currentReason: PhaseReason = "initial";
  private currentSlope = 0;
  private transitions = 0;

  // Auxiliary-signal log — kept so future subsystems can read what they
  // emitted without us having to add another shared store. Bounded.
  private readonly auxLog: Array<{
    signal: AuxSignal;
    value: number;
    at: number;
  }> = [];

  constructor(opts: PhaseGateOptions = {}) {
    this.windowSize = Math.max(2, opts.windowSize ?? 4);
    this.entrySlope = opts.entrySlope ?? 0.1;
    this.exitSlope = opts.exitSlope ?? 0.02;
    if (this.exitSlope >= this.entrySlope) {
      throw new Error(
        `PhaseGate: exitSlope (${this.exitSlope}) must be strictly less than entrySlope (${this.entrySlope}) to provide hysteresis`,
      );
    }
  }

  /**
   * Push a new OP sample and recompute the phase. Returns the current
   * snapshot regardless of whether a transition occurred.
   *
   * Pass `null` when no fresh OP sample is available (e.g. between
   * HiggsLogger snapshots) — the gate will return its existing state
   * unchanged so callers can blindly thread the value through.
   */
  update(op: number | null): PhaseSnapshot {
    if (op === null || !Number.isFinite(op)) {
      return this.snapshot();
    }
    this.window.push(op);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    if (this.window.length < this.windowSize) {
      this.currentSlope = 0;
      this.currentReason = "insufficient_samples";
      return this.snapshot();
    }

    const slope = this.computeSlope();
    this.currentSlope = slope;

    if (this.currentPhase === "EXPLORE") {
      if (slope > this.entrySlope) {
        this.currentPhase = "PRECISION";
        this.currentReason = "slope_rising_entered_precision";
        this.transitions++;
      } else {
        this.currentReason = "slope_holding_explore";
      }
    } else {
      // currentPhase === "PRECISION"
      if (slope <= this.exitSlope) {
        this.currentPhase = "EXPLORE";
        this.currentReason =
          slope < 0
            ? "slope_falling_exited_precision"
            : "slope_plateau_exited_precision";
        this.transitions++;
      } else {
        this.currentReason = "slope_holding_precision";
      }
    }

    return this.snapshot();
  }

  /**
   * Record an auxiliary gating signal for downstream visibility. NOT
   * consumed by the current decision logic — the OP-slope path is
   * authoritative for now. When BackboneDetector / Splicer /
   * FragmentGraph land, this is where their dam-rate / conductance /
   * stagnation streak metrics will arrive, and the decision logic will
   * grow to weight them alongside slope.
   *
   * TODO(splicer-task): when the Splicer is built, fold its
   *   `is_stagnant` flag into the EXPLORE-from-PRECISION exit path.
   * TODO(fragment-graph-task): fold sustained-low-backpressure
   *   conductance into the entry path so a fragment graduating to
   *   backbone can confirm the gate's PRECISION decision.
   */
  recordSignal(signal: AuxSignal, value: number, at: number): void {
    this.auxLog.push({ signal, value, at });
    // Bound the log so a long run doesn't accumulate forever.
    if (this.auxLog.length > 256) this.auxLog.shift();
  }

  /**
   * Clear the OP window and return to the initial EXPLORE state. Used
   * when an upstream event (e.g. an adversarial restart) discards the
   * current trajectory — without this the next OP sample would compute
   * a meaningless slope across the discontinuity.
   *
   * `transitionCount` is intentionally preserved so cumulative run
   * telemetry still reflects every observed phase change.
   */
  reset(): void {
    this.window.length = 0;
    this.currentPhase = "EXPLORE";
    this.currentReason = "initial";
    this.currentSlope = 0;
  }

  get phase(): Phase {
    return this.currentPhase;
  }

  get slope(): number {
    return this.currentSlope;
  }

  get transitionCount(): number {
    return this.transitions;
  }

  get auxiliarySignals(): ReadonlyArray<{
    signal: AuxSignal;
    value: number;
    at: number;
  }> {
    return this.auxLog;
  }

  /**
   * Linear-fit slope of the window: simple two-point estimate
   * (latest - oldest) / (windowSize - 1). This is robust enough at
   * window sizes 3-6 and avoids dragging in a least-squares helper for
   * a one-line computation. If we want a proper fit later, swap this
   * out without changing the public API.
   */
  private computeSlope(): number {
    const first = this.window[0]!;
    const last = this.window[this.window.length - 1]!;
    const span = this.window.length - 1;
    return (last - first) / span;
  }

  private snapshot(): PhaseSnapshot {
    return {
      phase: this.currentPhase,
      slope: round4(this.currentSlope),
      windowFilled: this.window.length,
      reason: this.currentReason,
    };
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
