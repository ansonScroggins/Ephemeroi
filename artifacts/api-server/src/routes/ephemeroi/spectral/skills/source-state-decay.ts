import type { SpectralOperator } from "../types";
import { sourceStateDecay } from "../actions";

const skill: SpectralOperator = {
  name: "source-state-decay",
  signature: ["Time"],
  planet: "Time",
  personaWeights: { Don: 0.4, Wife: 0.4, Son: 0.2 },
  expectedEffect: { illumination: 0, mobility: 0, structure: -0.03 },
  description:
    "Decay the most-stale source's constellation vector (capability/integrity/usability/trust) toward the 0.5 baseline by 0.05. The source-side complement to temporal smoothing — silent sources should drift back to neutral.",
  run: sourceStateDecay,
};

export default skill;
