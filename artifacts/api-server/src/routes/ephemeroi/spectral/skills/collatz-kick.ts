import type { SpectralOperator } from "../types";
import { collatzKick } from "../actions";

const skill: SpectralOperator = {
  name: "collatz-kick",
  signature: ["Energy"],
  planet: "Energy",
  personaWeights: { Don: 0.0, Wife: 0.2, Son: 0.8 },
  expectedEffect: { illumination: -0.02, mobility: 0.05, structure: -0.05 },
  description:
    "Pick a stagnant low-confidence belief (|conf|<0.3, supports≥2) and trim it 50% — deliberately reduce inertia so new evidence can re-shape it.",
  run: collatzKick,
};

export default skill;
