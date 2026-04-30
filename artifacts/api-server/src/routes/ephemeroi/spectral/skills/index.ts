/**
 * Skill manifest. The SpectralRegistry consumes this list at module-load
 * time to populate its name/planet/signature indexes.
 *
 * To add a new skill:
 *   1. Drop a `<name>.ts` file in this folder that default-exports a
 *      `SpectralOperator` instance.
 *   2. Add one import + one `ALL_SKILLS` entry below.
 *
 * (We use a static manifest rather than a runtime `fs.readdirSync` walk
 * because the api-server is shipped as a single esbuild bundle — runtime
 * directory scanning would not see the source files in production. The
 * "drop a file to register" ergonomics are preserved at the source level.)
 */
import type { SpectralOperator } from "../types";

import illuminationCollapse from "./illumination-collapse";
import contradictionCollapse from "./contradiction-collapse";
import beliefStabilization from "./belief-stabilization";
import phaseKickExpansion from "./phase-kick-expansion";
import collatzKick from "./collatz-kick";
import temporalSmoothing from "./temporal-smoothing";
import sourceStateDecay from "./source-state-decay";

export const ALL_SKILLS: SpectralOperator[] = [
  illuminationCollapse,
  contradictionCollapse,
  beliefStabilization,
  phaseKickExpansion,
  collatzKick,
  temporalSmoothing,
  sourceStateDecay,
];
