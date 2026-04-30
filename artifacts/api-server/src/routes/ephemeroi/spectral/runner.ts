/**
 * End-to-end runner: snapshot phase state, execute the operator, snapshot
 * again, persist the invocation, return the record.
 *
 * This is the single entry point used by both the HTTP routes and any
 * future internal callers (e.g. the main loop running the lens
 * controller as part of each cycle).
 */
import { logger } from "../../../lib/logger";
import { computePhaseState } from "./phaseState";
import { getOperator, listOperators } from "./operators";
import { selectOperator } from "./router";
import { insertInvocation } from "./store";
import { NoTargetError } from "./actions";
import type { InvocationRecord } from "./types";

export class UnknownOperatorError extends Error {
  constructor(name: string) {
    super(
      `Unknown spectral operator "${name}". Known: ${listOperators()
        .map((o) => o.name)
        .join(", ")}.`,
    );
    this.name = "UnknownOperatorError";
  }
}

/**
 * Run a specific operator by name. If `name` is omitted, the lens
 * controller picks the operator that best matches current phase demand.
 */
export async function invokeOperator(
  name?: string,
): Promise<InvocationRecord> {
  const phaseStateBefore = await computePhaseState();

  let operator;
  let selectionReason: string | null = null;
  if (!name) {
    const sel = await selectOperator(phaseStateBefore);
    operator = sel.operator;
    selectionReason = sel.reason;
  } else {
    const op = getOperator(name);
    if (!op) throw new UnknownOperatorError(name);
    operator = op;
  }

  let success = true;
  let narration: string;
  let effect: Record<string, unknown> = {};
  let errorMsg: string | null = null;

  try {
    const result = await operator.run();
    narration = result.narration;
    effect = result.effect;
  } catch (err) {
    success = false;
    if (err instanceof NoTargetError) {
      narration = `${operator.name}: no-op — ${err.message}`;
      effect = { action: operator.name, reason: err.message };
      errorMsg = err.message;
      logger.info(
        { operator: operator.name, reason: err.message },
        "Spectral operator no-op",
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      narration = `${operator.name}: failed — ${message}`;
      effect = { action: operator.name, error: message };
      errorMsg = message;
      logger.error(
        { err, operator: operator.name },
        "Spectral operator failed",
      );
    }
  }

  // Snapshot phase state again so the user can see what actually
  // shifted. If the operator failed, the after-state is still useful
  // (it should be ~identical to before-state, confirming the no-op).
  const phaseStateAfter = await computePhaseState();

  return insertInvocation({
    operator: operator.name,
    signature: operator.signature,
    planet: operator.planet,
    personaWeights: operator.personaWeights,
    selectionReason,
    phaseStateBefore,
    phaseStateAfter,
    effect,
    narration,
    success,
    error: errorMsg,
  });
}
