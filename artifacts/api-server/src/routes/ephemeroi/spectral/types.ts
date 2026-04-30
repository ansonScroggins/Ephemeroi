/**
 * Spectral-Skills Layer types.
 *
 * The Spectral-Skills Layer replaces traditional procedural "skills" with
 * phase-aligned cognitive operators grounded in Ephemeroi's physics
 * (illumination / mobility / structure / energy / time). Each operator is
 * a transformation that modifies the agent's internal landscape; the
 * landscape lives in the existing `ephemeroi_beliefs`,
 * `ephemeroi_contradictions`, and `ephemeroi_source_state` tables — this
 * layer does not maintain shadow state.
 */

export type Persona = "Don" | "Wife" | "Son";
export type SpectralPhase = "Light" | "Gravity" | "Energy" | "Time" | "Prism";

export interface PersonaWeights {
  Don: number;
  Wife: number;
  Son: number;
}

/**
 * A point in the global cognitive phase space, computed from real DB
 * state. Every spectral operator invocation snapshots this before and
 * after so the user can see what the operator actually shifted.
 *
 * - illuminationDensity: mean |confidence| across beliefs (0..1).
 *   High = decisive worldview; low = mostly forming/uncertain.
 * - phaseMobility: mean novelty across recent observations (0..1).
 *   High = covering new ground; low = re-treading.
 * - stagnationSeconds: time since the most recent belief mutation.
 *   High = the worldview has not moved in a while.
 * - personaImbalance: skew between supports and contradicts (0..1).
 *   High = one persona dominating (Don if confident-and-supported,
 *   Son if contradiction-heavy); low = balanced.
 * - attractorDrift: stddev of recent topic-belief stance flips (0..1).
 *   High = picture is changing; low = settled.
 */
export interface PhaseState {
  illuminationDensity: number;
  phaseMobility: number;
  stagnationSeconds: number;
  personaImbalance: number;
  attractorDrift: number;
}

/**
 * Effect deltas a spectral operator declares (and that we measure
 * post-hoc by diffing PhaseState before/after).
 */
export interface SpectralEffect {
  illumination: number; // expected change in illuminationDensity
  mobility: number; // expected change in phaseMobility
  structure: number; // expected change in confidence/order
}

/**
 * The static definition of a spectral operator. Mirrors the YAML-like
 * shape from the spec but is a TS object so the registry is type-safe and
 * the operator's run() can be called directly.
 */
export interface SpectralOperator {
  name: string;
  signature: SpectralPhase[];
  planet: SpectralPhase;
  personaWeights: PersonaWeights;
  /** Self-declared expected effect (used by the lens controller scorer). */
  expectedEffect: SpectralEffect;
  description: string;
  /**
   * Execute the operator against real DB state. Returns whatever
   * concrete change the operator made (which row it touched, what value
   * shifted) plus a one-line narration. Throws if the operator could not
   * find anything to act on; the runner catches and records `success=false`.
   */
  run(): Promise<{
    narration: string;
    effect: Record<string, unknown>;
  }>;
  /**
   * Optional cheap pre-flight: returns false if the operator cannot
   * possibly run right now (e.g. autonomy off for `phase-kick-expansion`).
   * The lens controller filters infeasible operators *before* scoring so
   * it never picks a guaranteed no-op when a runnable alternative exists.
   * If omitted, the operator is assumed feasible (it will fall through to
   * NoTargetError if its action can't find a target).
   */
  feasible?(): Promise<boolean>;
}

/**
 * A persisted invocation record (the "phase-transition graph" the spec
 * calls for). Mirrors the shape of `ephemeroi_spectral_invocations`.
 */
export interface InvocationRecord {
  id: number;
  operator: string;
  signature: SpectralPhase[];
  planet: SpectralPhase;
  personaWeights: PersonaWeights;
  selectionReason: string | null;
  phaseStateBefore: PhaseState;
  phaseStateAfter: PhaseState | null;
  effect: Record<string, unknown>;
  narration: string;
  success: boolean;
  error: string | null;
  invokedAt: Date;
}
