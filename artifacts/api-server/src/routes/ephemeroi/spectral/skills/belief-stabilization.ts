import type { SpectralOperator } from "../types";
import { beliefStabilization } from "../actions";

const skill: SpectralOperator = {
  name: "belief-stabilization",
  signature: ["Gravity"],
  planet: "Gravity",
  personaWeights: { Don: 0.7, Wife: 0.3, Son: 0.0 },
  expectedEffect: { illumination: 0.03, mobility: 0, structure: 0.1 },
  description:
    "Lock in the strongest positively-held belief: nudge its confidence further toward +1 by a small step. Opposite of trim/clear.",
  run: beliefStabilization,
};

export default skill;
