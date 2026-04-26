import { EventEmitter } from "node:events";
import { z } from "zod/v4";
import { logger } from "./logger";

// Shared envelope for cross-site signals. Both Ephemeroi (structural alerts)
// and Metacog (truth-anchor / exploration) produce envelopes in this shape;
// the unified Telegram convergence layer consumes them. Keep the surface
// small and stable — site-specific data goes into `evidence`.
export const SignalEnvelopeSchema = z.object({
  origin: z.enum(["metacog", "ephemeroi"]),
  role: z.enum(["structural", "truth-anchor", "exploration"]),
  severity: z.number().min(0).max(1),
  headline: z.string().min(1),
  body: z.string(),
  subject: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;

/**
 * Called once when the unified Telegram convergence layer is done with a
 * specific envelope — `success` is true iff Telegram acknowledged the
 * (possibly merged) outbound message. Callers (e.g. Ephemeroi's loop) use
 * this to update per-report delivery state accurately, instead of marking
 * "delivered" the moment they hand off.
 *
 * Not part of the wire-level envelope on purpose: callbacks can't cross the
 * inbound HTTP boundary, so they live in the in-process publish options.
 */
export type SignalDeliveryCallback = (success: boolean) => void;

export interface PublishSignalOptions {
  onDelivered?: SignalDeliveryCallback;
}

// In-process bus. The convergence subscriber wires its Telegram fan-out
// here; producers stay decoupled and never block on Telegram.
class SignalBus extends EventEmitter {}

export const signalBus: SignalBus = new SignalBus();
signalBus.setMaxListeners(20);

export function publishSignal(
  envelope: SignalEnvelope,
  options?: PublishSignalOptions,
): void {
  const parsed = SignalEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.issues, envelope }, "publishSignal: invalid envelope");
    // Surface the failure to the caller's delivery callback so it doesn't
    // sit in a "pending" UI state forever. Wrap in try/catch so a buggy
    // callback can't propagate a synchronous throw back into the caller's
    // request handler.
    try {
      options?.onDelivered?.(false);
    } catch (err) {
      logger.warn({ err }, "publishSignal: onDelivered callback threw");
    }
    return;
  }
  logger.info(
    {
      origin: parsed.data.origin,
      role: parsed.data.role,
      severity: parsed.data.severity,
      subject: parsed.data.subject,
      headline: parsed.data.headline,
    },
    "signal emitted",
  );
  signalBus.emit("signal", parsed.data, options?.onDelivered);
}
