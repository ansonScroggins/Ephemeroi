import type { SpectralOperator } from "../types";
import { temporalSmoothing } from "../actions";

const skill: SpectralOperator = {
  name: "temporal-smoothing",
  signature: ["Time"],
  planet: "Time",
  personaWeights: { Don: 0.5, Wife: 0.5, Son: 0.0 },
  expectedEffect: { illumination: -0.01, mobility: 0, structure: -0.02 },
  description:
    "Apply gentle passive forgetting (×0.95) to the oldest active belief — the long-term complement to the manual Trim/Clear UI.",
  run: temporalSmoothing,
};

export default skill;
