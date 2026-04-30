/**
 * End-to-end runner: snapshot phase state, execute the operator, snapshot
 * again, persist the invocation, return the record.
 *
 * Two entry points:
 *   - `invokeOperator(name?)` — public, used by the HTTP route. If no
 *     name is given, the lens controller picks the best operator.
 *   - `runOperatorInstance(operator, selectionReason?)` — internal, used
 *     by the SpectralRegistry's `composePipeline` (after it has already
 *     selected the operator) and by the self-build loop.
 *
 * Both go through the same persistence path so every invocation lands
 * in the `ephemeroi_spectral_invocations` table.
 */
import { logger } from "../../../lib/logger";
import { computePhaseState } from "./phaseState";
import { getOperator, listOperators } from "./operators";
import { selectOperator } from "./router";
import { insertInvocation } from "./store";
import { NoTargetError } from "./actions";
import type { InvocationRecord, SpectralOperator } from "./types";

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
 * Run a specific operator instance end-to-end. Snapshots phase state
 * before and after, catches NoTargetError vs other errors, and persists
 * the invocation row.
 */
export async function runOperatorInstance(
  operator: SpectralOperator,
  selectionReason: string | null = null,
): Promise<InvocationRecord> {
  const phaseStateBefore = await computePhaseState();

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

/**
 * Run a specific operator by name. If `name` is omitted, the lens
 * controller picks the operator that best matches current phase demand.
 */
export async function invokeOperator(
  name?: string,
): Promise<InvocationRecord> {
  if (name) {
    const op = getOperator(name);
    if (!op) throw new UnknownOperatorError(name);
    return runOperatorInstance(op, null);
  }
  const phaseStateBefore = await computePhaseState();
  const sel = await selectOperator(phaseStateBefore);
  return runOperatorInstance(sel.operator, sel.reason);
}
