/**
 * Autonomous self-build loop.
 *
 * One cycle = two phases:
 *   1. Generative phase  — composePipeline(["Energy", "Gravity"])
 *      Perturb the worldview (Energy) then stabilise the strongest
 *      surviving belief (Gravity).
 *   2. Reflective phase  — composePipeline(["Light", "Prism"])
 *      Only runs if the generative phase actually did something
 *      (i.e. at least one of the two skills successfully mutated
 *      real DB state). The Light step collapses illumination around
 *      whatever Energy/Gravity surfaced; Prism is the lens-controller
 *      meta-pick that records the next move.
 *
 * Every step is persisted to `ephemeroi_spectral_invocations` via the
 * shared runner — the loop never bypasses persistence. Cycles are
 * idempotent and self-recovering: any thrown error is caught, logged,
 * and the loop continues with a backoff.
 *
 * Off by default. Opt in with `EPHEMEROI_SPECTRAL_SELF_BUILD=1`.
 */
import { logger } from "../../../lib/logger";
import { spectralRegistry } from "./registry";
import { runOperatorInstance } from "./runner";
import type { InvocationRecord, SpectralPhase } from "./types";

export type CycleResult = "ok" | "gated" | "errored" | "idle";

export interface SelfBuildStatus {
  enabled: boolean;
  intervalMs: number;
  cycleCount: number;
  startedAt: string | null;
  lastCycleAt: string | null;
  lastCycleResult: CycleResult;
  lastInvocations: InvocationRecord[];
}

const DEFAULT_INTERVAL_MS = 60_000;
const BACKOFF_INTERVAL_MS = 30_000;
// Hard floor on the interval so a misconfigured env var can't pin a CPU
// or hammer the DB. The lens-controller scoring is cheap but persisting
// every step writes a row, so 1s is the minimum tolerable cadence.
const MIN_INTERVAL_MS = 1_000;

const GENERATIVE_PHASE: SpectralPhase[] = ["Energy", "Gravity"];
const REFLECTIVE_PHASE: SpectralPhase[] = ["Light", "Prism"];

const status: SelfBuildStatus = {
  enabled: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  cycleCount: 0,
  startedAt: null,
  lastCycleAt: null,
  lastCycleResult: "idle",
  lastInvocations: [],
};

let stopRequested = false;
let runningPromise: Promise<void> | null = null;
// Single-flight guard. The autonomous loop, the HTTP trigger route, and
// any future caller all share `runOneCycle` — without this, two
// concurrent calls would race on `status.cycleCount`, double-write
// invocations, and potentially overlap DB mutations on the same beliefs.
// We serialise: while a cycle is in flight, every other caller awaits
// the same promise and gets the same result back.
let inFlightCycle: Promise<{
  result: CycleResult;
  invocations: InvocationRecord[];
}> | null = null;

/**
 * Run a single self-build cycle, regardless of loop state. Used both
 * internally by the loop and by the manual-trigger HTTP route.
 *
 * Single-flight: concurrent callers share the in-flight result — only
 * one cycle executes at a time across the whole process.
 */
export async function runOneCycle(opts?: {
  reasonPrefix?: string;
}): Promise<{ result: CycleResult; invocations: InvocationRecord[] }> {
  if (inFlightCycle) return inFlightCycle;
  inFlightCycle = runOneCycleImpl(opts).finally(() => {
    inFlightCycle = null;
  });
  return inFlightCycle;
}

async function runOneCycleImpl(opts?: {
  reasonPrefix?: string;
}): Promise<{ result: CycleResult; invocations: InvocationRecord[] }> {
  const cycleNumber = status.cycleCount + 1;
  const prefix =
    opts?.reasonPrefix ?? `[self-build cycle ${cycleNumber}]`;
  let invocations: InvocationRecord[] = [];
  let result: CycleResult = "ok";
  try {
    // Generative phase
    const generative = await spectralRegistry.composePipeline(
      GENERATIVE_PHASE,
      {
        reasonPrefix: prefix,
        runner: runOperatorInstance,
      },
    );
    invocations = invocations.concat(generative);

    const generativeProduced = generative.some((r) => r.success);
    if (!generativeProduced) {
      logger.info(
        { cycle: cycleNumber, ranSteps: generative.length },
        "Self-build cycle gated: generative phase produced no effect, skipping reflective phase",
      );
      result = "gated";
    } else {
      const reflective = await spectralRegistry.composePipeline(
        REFLECTIVE_PHASE,
        {
          reasonPrefix: prefix,
          runner: runOperatorInstance,
        },
      );
      invocations = invocations.concat(reflective);
    }
  } catch (err) {
    logger.error({ err, cycle: cycleNumber }, "Self-build cycle failed");
    result = "errored";
  }
  status.cycleCount = cycleNumber;
  status.lastCycleAt = new Date().toISOString();
  status.lastCycleResult = result;
  status.lastInvocations = invocations;
  return { result, invocations };
}

/**
 * Start the self-build loop. Returns an async stop function. Calling
 * `start` again while running is a no-op (the existing loop continues).
 */
export function startSelfBuildLoop(opts?: {
  intervalMs?: number;
}): { stop: () => Promise<void>; status: () => SelfBuildStatus } {
  if (runningPromise) {
    logger.warn(
      "Self-build loop already running, ignoring duplicate start request",
    );
    return { stop: stopSelfBuildLoop, status: () => ({ ...status }) };
  }
  status.enabled = true;
  status.intervalMs = Math.max(
    MIN_INTERVAL_MS,
    opts?.intervalMs ?? DEFAULT_INTERVAL_MS,
  );
  status.startedAt = new Date().toISOString();
  stopRequested = false;
  logger.info(
    { intervalMs: status.intervalMs },
    "spectralSelfBuildLoop: started",
  );

  runningPromise = (async () => {
    while (!stopRequested) {
      const { result } = await runOneCycle();
      const sleepMs =
        result === "errored" ? BACKOFF_INTERVAL_MS : status.intervalMs;
      await sleep(sleepMs);
    }
    status.enabled = false;
    logger.info("spectralSelfBuildLoop: stopped");
  })();

  return { stop: stopSelfBuildLoop, status: () => ({ ...status }) };
}

export async function stopSelfBuildLoop(): Promise<void> {
  stopRequested = true;
  if (runningPromise) {
    await runningPromise;
    runningPromise = null;
  }
}

export function getSelfBuildStatus(): SelfBuildStatus {
  return { ...status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
