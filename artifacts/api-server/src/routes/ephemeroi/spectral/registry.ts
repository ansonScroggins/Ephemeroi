/**
 * SpectralRegistry — the canonical store of spectral skills, indexed by
 * name, planet, and signature. Exposes a `composePipeline` method that
 * lets the autonomous self-build loop request a sequence of cognitive
 * moves by signature (e.g. `["Energy", "Gravity"]` for "perturb then
 * stabilise") without naming individual operators — the registry picks
 * the best fit for each phase given the current cognitive state.
 *
 * The registry is initialised at module load from the static skill
 * manifest in `./skills/index.ts`. Adding a new skill is a one-line
 * change to that manifest plus a new file in `./skills/`.
 */
import { logger } from "../../../lib/logger";
import { ALL_SKILLS } from "./skills";
import { computePhaseState } from "./phaseState";
import {
  computeDemand,
  scoreOperator,
  explain,
  filterFeasible,
  selectOperator,
} from "./router";
import type {
  InvocationRecord,
  PhaseState,
  SpectralOperator,
  SpectralPhase,
} from "./types";

export class SpectralRegistry {
  private readonly byName = new Map<string, SpectralOperator>();
  private readonly byPlanet = new Map<SpectralPhase, SpectralOperator[]>();
  private readonly bySignature = new Map<SpectralPhase, SpectralOperator[]>();

  register(skill: SpectralOperator): void {
    if (this.byName.has(skill.name)) {
      logger.warn(
        { skill: skill.name },
        "SpectralRegistry: skill already registered, overwriting",
      );
    }
    this.byName.set(skill.name, skill);

    const planetBucket = this.byPlanet.get(skill.planet) ?? [];
    planetBucket.push(skill);
    this.byPlanet.set(skill.planet, planetBucket);

    for (const sig of skill.signature) {
      const sigBucket = this.bySignature.get(sig) ?? [];
      sigBucket.push(skill);
      this.bySignature.set(sig, sigBucket);
    }
  }

  getSkill(name: string): SpectralOperator | undefined {
    return this.byName.get(name);
  }

  getSkillsByPlanet(planet: SpectralPhase): SpectralOperator[] {
    return this.byPlanet.get(planet) ?? [];
  }

  getSkillsBySignature(sig: SpectralPhase): SpectralOperator[] {
    return this.bySignature.get(sig) ?? [];
  }

  list(): SpectralOperator[] {
    return Array.from(this.byName.values());
  }

  /**
   * Pick the best skill that carries `signature` in its signature list,
   * scoring against the current phase state with the same demand math
   * the lens controller uses. Returns `null` if no feasible skill
   * exposes that signature (vs. throwing — the pipeline can decide
   * whether to skip or fail).
   */
  async selectBestForSignature(
    sig: SpectralPhase,
    state: PhaseState,
  ): Promise<{ operator: SpectralOperator; reason: string } | null> {
    const candidates = this.getSkillsBySignature(sig);
    if (candidates.length === 0) return null;
    const eligible = await filterFeasible(candidates);
    if (eligible.length === 0) return null;
    const d = computeDemand(state);
    let bestOp: SpectralOperator | null = null;
    let bestScore = -Infinity;
    for (const op of eligible) {
      const s = scoreOperator(op, d);
      if (s > bestScore) {
        bestScore = s;
        bestOp = op;
      }
    }
    if (!bestOp) return null;
    return {
      operator: bestOp,
      reason: `[signature: ${sig}] ${explain(bestOp.name, d)}`,
    };
  }

  /**
   * Compose a sequence of skills by signature. For each signature in
   * order: pick the best feasible skill, run it (persisting an invocation
   * row), and recompute the phase state so the next signature's pick
   * sees the updated landscape. Returns the list of invocation records
   * — one per signature that actually ran (signatures with no feasible
   * skill are skipped and noted in the returned record's
   * `selectionReason`).
   *
   * The runner is injected lazily to avoid a circular import
   * (registry ↔ runner).
   */
  async composePipeline(
    signatures: SpectralPhase[],
    opts: {
      reasonPrefix?: string;
      runner: (
        op: SpectralOperator,
        selectionReason: string,
      ) => Promise<InvocationRecord>;
    },
  ): Promise<InvocationRecord[]> {
    const out: InvocationRecord[] = [];
    for (const sig of signatures) {
      let state: PhaseState;
      try {
        state = await computePhaseState();
      } catch (err) {
        logger.error(
          { err, sig },
          "SpectralRegistry.composePipeline: computePhaseState failed",
        );
        break;
      }
      // "Prism" is the lens-controller meta-signature: instead of looking
      // up a Prism-only skill (none of the seven concrete operators
      // carries Prism — that would defeat the meta-pick), we delegate to
      // the same `selectOperator` the /spectral/invoke route uses, which
      // scores every feasible skill against full phase demand and picks
      // the global best. This is what makes "Light → Prism" actually
      // realisable (Light reflects, then Prism picks the next move).
      const pick =
        sig === "Prism"
          ? await this.selectViaLensController(sig)
          : await this.selectBestForSignature(sig, state);
      if (!pick) {
        logger.info(
          { sig },
          "SpectralRegistry.composePipeline: no feasible skill for signature, skipping",
        );
        continue;
      }
      const reason = opts.reasonPrefix
        ? `${opts.reasonPrefix} ${pick.reason}`
        : pick.reason;
      const record = await opts.runner(pick.operator, reason);
      out.push(record);
    }
    return out;
  }

  /**
   * Lens-controller bridge. Calls the global `selectOperator` (the same
   * function the manual `/spectral/invoke` route uses) and adapts its
   * return shape to `selectBestForSignature`'s contract so
   * `composePipeline` can treat Prism uniformly with any other signature.
   */
  private async selectViaLensController(
    sig: SpectralPhase,
  ): Promise<{ operator: SpectralOperator; reason: string } | null> {
    try {
      const choice = await selectOperator(await computePhaseState());
      return {
        operator: choice.operator,
        reason: `[signature: ${sig} / lens-controller] ${choice.reason}`,
      };
    } catch (err) {
      logger.warn(
        { err, sig },
        "SpectralRegistry.selectViaLensController: lens-controller selection failed",
      );
      return null;
    }
  }
}

/**
 * Singleton registry, populated from the manifest at module-load time.
 * All other modules (operators.ts wrappers, runner.ts, self-build loop)
 * use this instance.
 */
export const spectralRegistry = new SpectralRegistry();
for (const skill of ALL_SKILLS) {
  spectralRegistry.register(skill);
}
