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

// In-process bus. The convergence task (see
// `.local/tasks/unified-telegram-convergence.md`) wires its Telegram fan-out
// here as a subscriber; for now we just log so producers can be tested in
// isolation.
class SignalBus extends EventEmitter {}

export const signalBus: SignalBus = new SignalBus();
signalBus.setMaxListeners(20);

export function publishSignal(envelope: SignalEnvelope): void {
  const parsed = SignalEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.issues, envelope }, "publishSignal: invalid envelope");
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
  signalBus.emit("signal", parsed.data);
}
