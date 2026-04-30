/**
 * Spectral operator registry — the canonical list of cognitive operators
 * available to Ephemeroi. Each entry maps the spec's
 * (name / signature / planet / personaWeights / effect) shape to the
 * concrete `actions.ts` implementation that mutates real DB state.
 */
import type { SpectralOperator } from "./types";
import {
  illuminationCollapse,
  contradictionCollapse,
  beliefStabilization,
  phaseKickExpansion,
  collatzKick,
  temporalSmoothing,
  sourceStateDecay,
} from "./actions";
import { getSettings } from "../store";

export const SPECTRAL_OPERATORS: SpectralOperator[] = [
  {
    name: "illumination-collapse",
    signature: ["Light"],
    planet: "Light",
    personaWeights: { Don: 0.1, Wife: 0.8, Son: 0.1 },
    expectedEffect: { illumination: 0.05, mobility: 0, structure: 0.05 },
    description:
      "Find the highest-supported forming belief and collapse the illumination field around it: nudge confidence one step in the direction the support points.",
    run: illuminationCollapse,
  },
  {
    name: "contradiction-collapse",
    signature: ["Light", "Gravity"],
    planet: "Light",
    personaWeights: { Don: 0.6, Wife: 0.4, Son: 0.0 },
    expectedEffect: { illumination: 0.08, mobility: -0.02, structure: 0.1 },
    description:
      "Resolve the most recent open contradiction; if the linked belief is losing the argument (more contradicts than supports), trim it 50%.",
    run: contradictionCollapse,
  },
  {
    name: "belief-stabilization",
    signature: ["Gravity"],
    planet: "Gravity",
    personaWeights: { Don: 0.7, Wife: 0.3, Son: 0.0 },
    expectedEffect: { illumination: 0.03, mobility: 0, structure: 0.1 },
    description:
      "Lock in the strongest positively-held belief: nudge its confidence further toward +1 by a small step. Opposite of trim/clear.",
    run: beliefStabilization,
  },
  {
    name: "phase-kick-expansion",
    signature: ["Energy"],
    planet: "Energy",
    personaWeights: { Don: 0.1, Wife: 0.1, Son: 0.8 },
    expectedEffect: { illumination: 0.0, mobility: 0.2, structure: 0.0 },
    description:
      "Apply a structured perturbation: run discovery on recent observations and (if autonomy is enabled) add new sources for the agent to watch.",
    run: phaseKickExpansion,
    async feasible() {
      const settings = await getSettings();
      return settings.autonomyEnabled;
    },
  },
  {
    name: "collatz-kick",
    signature: ["Energy"],
    planet: "Energy",
    personaWeights: { Don: 0.0, Wife: 0.2, Son: 0.8 },
    expectedEffect: { illumination: -0.02, mobility: 0.05, structure: -0.05 },
    description:
      "Pick a stagnant low-confidence belief (|conf|<0.3, supports≥2) and trim it 50% — deliberately reduce inertia so new evidence can re-shape it.",
    run: collatzKick,
  },
  {
    name: "temporal-smoothing",
    signature: ["Time"],
    planet: "Time",
    personaWeights: { Don: 0.5, Wife: 0.5, Son: 0.0 },
    expectedEffect: { illumination: -0.01, mobility: 0, structure: -0.02 },
    description:
      "Apply gentle passive forgetting (×0.95) to the oldest active belief — the long-term complement to the manual Trim/Clear UI.",
    run: temporalSmoothing,
  },
  {
    name: "source-state-decay",
    signature: ["Time"],
    planet: "Time",
    personaWeights: { Don: 0.4, Wife: 0.4, Son: 0.2 },
    expectedEffect: { illumination: 0, mobility: 0, structure: -0.03 },
    description:
      "Decay the most-stale source's constellation vector (capability/integrity/usability/trust) toward the 0.5 baseline by 0.05. The source-side complement to temporal smoothing — silent sources should drift back to neutral.",
    run: sourceStateDecay,
  },
];

const BY_NAME = new Map(SPECTRAL_OPERATORS.map((o) => [o.name, o]));

export function getOperator(name: string): SpectralOperator | undefined {
  return BY_NAME.get(name);
}

export function listOperators(): SpectralOperator[] {
  return SPECTRAL_OPERATORS;
}
