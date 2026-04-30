import type { SpectralOperator } from "../types";
import { contradictionCollapse } from "../actions";

const skill: SpectralOperator = {
  name: "contradiction-collapse",
  signature: ["Light", "Gravity"],
  planet: "Light",
  personaWeights: { Don: 0.6, Wife: 0.4, Son: 0.0 },
  expectedEffect: { illumination: 0.08, mobility: -0.02, structure: 0.1 },
  description:
    "Resolve the most recent open contradiction; if the linked belief is losing the argument (more contradicts than supports), trim it 50%.",
  run: contradictionCollapse,
};

export default skill;
