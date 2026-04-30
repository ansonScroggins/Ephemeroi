import type { SpectralOperator } from "../types";
import { phaseKickExpansion } from "../actions";
import { getSettings } from "../../store";

const skill: SpectralOperator = {
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
};

export default skill;
