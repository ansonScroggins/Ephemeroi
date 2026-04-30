import type { SpectralOperator } from "../types";
import { illuminationCollapse } from "../actions";

const skill: SpectralOperator = {
  name: "illumination-collapse",
  signature: ["Light"],
  planet: "Light",
  personaWeights: { Don: 0.1, Wife: 0.8, Son: 0.1 },
  expectedEffect: { illumination: 0.05, mobility: 0, structure: 0.05 },
  description:
    "Find the highest-supported forming belief and collapse the illumination field around it: nudge confidence one step in the direction the support points.",
  run: illuminationCollapse,
};

export default skill;
