import { logger } from "../../lib/logger";
import { applyTopicBeliefDecay } from "./store";
import { decayHalfLifeMultiplier, getCognitiveMood } from "./cognitiveField";

/**
 * Periodic passive-decay loop for autonomous topic beliefs.
 *
 * Every `EPHEMEROI_OPINION_DECAY_INTERVAL_MS` (default 30 min) we sweep
 * the `ephemeroi_topic_beliefs` table and pull each row's confidence
 * exponentially toward neutral 0.5. The half-life is the global
 * `DEFAULT_OPINION_HALF_LIFE_MS` (default 7 days) multiplied by the
 * cognitive field's current mood multiplier:
 *   * settled    → 1.7x (opinions stick longer)
 *   * neutral    → 1.0x
 *   * contested  → 0.7x
 *   * oscillating → 0.55x (opinions move fastest)
 *
 * The sweep is purely additive history-wise: it prepends a `decay: true`
 * entry to each row's history so the trajectory in the UI shows the
 * passive movement separately from evidence-driven updates.
 *
 * Failure modes are absorbed — a sweep that throws gets logged and the
 * next tick still fires. We never crash the api-server because of decay.
 *
 * The first sweep runs after the first interval, NOT immediately on
 * boot, so we don't compete with the api-server's startup work or
 * apply a huge accumulated decay if the process was offline.
 */

const DEFAULT_DECAY_INTERVAL_MS = 30 * 60 * 1000; // 30 min

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function startTopicBeliefDecayLoop(): void {
  if (timer) return;
  const intervalMs =
    Number(process.env["EPHEMEROI_OPINION_DECAY_INTERVAL_MS"]) ||
    DEFAULT_DECAY_INTERVAL_MS;
  timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  // Don't block process exit on this timer.
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { intervalMs },
    "topicBeliefDecayLoop: started",
  );
}

export function stopTopicBeliefDecayLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runOnce(): Promise<void> {
  if (inFlight) {
    // Decay sweeps are scheduled on a fixed interval and they touch every
    // belief row, so a slow sweep skipping the next tick is the right
    // behavior — no useful information is lost by skipping a 30-min slot.
    return;
  }
  inFlight = true;
  try {
    const mult = decayHalfLifeMultiplier();
    const mood = getCognitiveMood();
    const result = await applyTopicBeliefDecay({ halfLifeMultiplier: mult });
    if (result.decayed > 0) {
      logger.info(
        { ...result, halfLifeMultiplier: mult, mood },
        "topicBeliefDecayLoop: sweep complete",
      );
    } else {
      logger.debug(
        { ...result, halfLifeMultiplier: mult, mood },
        "topicBeliefDecayLoop: nothing to decay",
      );
    }
  } catch (err) {
    logger.warn({ err }, "topicBeliefDecayLoop: sweep failed");
  } finally {
    inFlight = false;
  }
}

/** Test/manual trigger entry point. */
export function _runOnceForTests(): Promise<void> {
  return runOnce();
}
