import { logger } from "../../lib/logger";
import { embedBatch, normalize, cosine } from "../society/embeddings";
import {
  getSettings,
  listSources,
  insertObservationIfNew,
  listUnreflectedObservations,
  setObservationEmbedding,
  markObservationReflected,
  listEmbeddedObservationsForNovelty,
  listBeliefs,
  upsertBelief,
  insertContradiction,
  insertReport,
  markReportDelivered,
  type ObservationRow,
} from "./store";
import { ingestSource } from "./ingest";
import { reflectOnObservation } from "./reflect";
import { sendTelegramReport, isTelegramConfigured } from "./telegram";
import { bus } from "./bus";
import {
  observationToWire,
  beliefToWire,
  contradictionToWire,
  reportToWire,
} from "./wire";

const NOVELTY_SAMPLE_SIZE = 200;
const MAX_REFLECTIONS_PER_CYCLE = 6;

export interface CycleResult {
  observationsAdded: number;
  beliefsUpdated: number;
  contradictionsFound: number;
  reportsCreated: number;
  ranAt: Date;
  durationMs: number;
}

class EphemeroiLoop {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private lastCycleAt: Date | null = null;
  private nextCycleAt: Date | null = null;
  private lastError: string | null = null;
  private currentIntervalSeconds = 300;

  start(): void {
    if (this.timer) return;
    void this.scheduleNext();
  }

  status(): {
    running: boolean;
    lastCycleAt: Date | null;
    nextCycleAt: Date | null;
    lastError: string | null;
  } {
    return {
      running: this.timer !== null,
      lastCycleAt: this.lastCycleAt,
      nextCycleAt: this.nextCycleAt,
      lastError: this.lastError,
    };
  }

  isInFlight(): boolean {
    return this.inFlight;
  }

  /**
   * Force one cycle to run right now (out-of-band from the schedule).
   * Throws if a cycle is already in flight.
   */
  async runOnce(): Promise<CycleResult> {
    if (this.inFlight) throw new InFlightError();
    return this.cycle();
  }

  private async scheduleNext(): Promise<void> {
    let intervalSeconds = this.currentIntervalSeconds;
    try {
      const settings = await getSettings();
      intervalSeconds = settings.intervalSeconds;
      this.currentIntervalSeconds = intervalSeconds;
    } catch (err) {
      logger.warn({ err }, "Ephemeroi loop: failed to read settings");
    }
    const delay = Math.max(1_000, intervalSeconds * 1000);
    this.nextCycleAt = new Date(Date.now() + delay);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    try {
      const settings = await getSettings();
      if (!settings.paused && !this.inFlight) {
        await this.cycle();
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "Ephemeroi loop tick failed");
    } finally {
      void this.scheduleNext();
    }
  }

  private async cycle(): Promise<CycleResult> {
    this.inFlight = true;
    const startedAt = Date.now();
    const ranAt = new Date(startedAt);
    let observationsAdded = 0;
    let beliefsUpdated = 0;
    let contradictionsFound = 0;
    let reportsCreated = 0;
    try {
      const settings = await getSettings();

      // 1. Pull fresh observations from every active source.
      const sources = await listSources();
      for (const source of sources) {
        if (!source.active) continue;
        const { added } = await ingestSource(source);
        observationsAdded += added.length;
      }

      // 2. Embed any unreflected observations + compute novelty.
      const unreflected = await listUnreflectedObservations(
        MAX_REFLECTIONS_PER_CYCLE,
      );
      if (unreflected.length > 0) {
        await embedAndScoreNovelty(unreflected);
      }

      // 3. Reflect on each one and apply updates.
      const beliefs = await listBeliefs();
      const beliefSummaries = beliefs.slice(0, 30).map((b) => ({
        id: b.id,
        proposition: b.proposition,
        confidence: b.confidence,
      }));

      for (const obs of unreflected) {
        try {
          // Re-fetch to get updated embedding/novelty after embedAndScoreNovelty.
          const reflection = await reflectOnObservation({
            observationTitle: obs.title,
            observationSnippet: obs.snippet,
            observationSource: obs.sourceLabel,
            novelty: obs.novelty,
            recentBeliefs: beliefSummaries,
          });

          // Apply belief updates.
          for (const upd of reflection.beliefUpdates) {
            const updatedBelief = await upsertBelief({
              proposition: upd.proposition,
              deltaConfidence: upd.deltaConfidence,
              embedding: obs.embedding,
            });
            beliefsUpdated += 1;
            bus.publish({
              type: "belief",
              payload: beliefToWire(updatedBelief),
            });
          }

          // Apply contradictions.
          for (const c of reflection.contradictions) {
            const validBeliefId =
              c.beliefId !== null &&
              beliefSummaries.some((b) => b.id === c.beliefId)
                ? c.beliefId
                : null;
            const contradiction = await insertContradiction({
              beliefId: validBeliefId,
              observationId: obs.id,
              summary: c.summary,
            });
            contradictionsFound += 1;
            bus.publish({
              type: "contradiction",
              payload: contradictionToWire(contradiction),
            });
          }

          // Mark observation reflected.
          await markObservationReflected(obs.id, reflection.importance);
          obs.importance = reflection.importance;
          obs.reflected = true;
          obs.reflectedAt = new Date();
          bus.publish({ type: "observation", payload: observationToWire(obs) });

          // Possibly create a report.
          if (reflection.importance >= settings.importanceThreshold) {
            const report = await insertReport({
              importance: reflection.importance,
              headline: reflection.headline,
              body: reflection.message,
              observationIds: [obs.id],
            });
            reportsCreated += 1;

            if (settings.telegramEnabled && isTelegramConfigured()) {
              const ok = await sendTelegramReport(report);
              if (ok) {
                await markReportDelivered(report.id);
                report.delivered = true;
                report.deliveredAt = new Date();
              }
            }
            bus.publish({ type: "report", payload: reportToWire(report) });
          }
        } catch (err) {
          logger.warn(
            { err, observationId: obs.id },
            "Reflection failed for observation",
          );
          // Mark reflected anyway so we don't loop on a poison observation.
          await markObservationReflected(obs.id, 0).catch(() => {});
        }
      }

      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "Ephemeroi cycle failed");
    } finally {
      this.inFlight = false;
      this.lastCycleAt = ranAt;
      const result: CycleResult = {
        observationsAdded,
        beliefsUpdated,
        contradictionsFound,
        reportsCreated,
        ranAt,
        durationMs: Date.now() - startedAt,
      };
      bus.publish({
        type: "cycle",
        payload: {
          observationsAdded: result.observationsAdded,
          beliefsUpdated: result.beliefsUpdated,
          contradictionsFound: result.contradictionsFound,
          reportsCreated: result.reportsCreated,
          ranAt: result.ranAt.toISOString(),
          durationMs: result.durationMs,
        },
      });
      // eslint-disable-next-line no-unsafe-finally
      return result;
    }
  }
}

async function embedAndScoreNovelty(
  observations: ObservationRow[],
): Promise<void> {
  // Pull existing embedded observations for novelty comparison.
  const existing = await listEmbeddedObservationsForNovelty(NOVELTY_SAMPLE_SIZE);
  const existingNorm = existing.map((e) => normalize(e.embedding));

  const inputs = observations.map((o) => `${o.title}\n${o.snippet}`);
  let vectors: number[][] = [];
  try {
    vectors = await embedBatch(inputs);
  } catch (err) {
    logger.warn(
      { err },
      "Embedding batch failed; defaulting all observations to novelty=1",
    );
    for (const obs of observations) {
      const fallback = new Array<number>(1536).fill(0);
      await setObservationEmbedding(obs.id, fallback, 1);
      obs.embedding = fallback;
      obs.novelty = 1;
    }
    return;
  }

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]!;
    const vec = vectors[i]!;
    const norm = normalize(vec);
    let maxSim = 0;
    for (const e of existingNorm) {
      const s = cosine(norm, e);
      if (s > maxSim) maxSim = s;
    }
    const novelty = clamp(1 - maxSim, 0, 1);
    await setObservationEmbedding(obs.id, norm, novelty);
    obs.embedding = norm;
    obs.novelty = novelty;
    // Add to running set so observations later in this batch can also see it.
    existingNorm.push(norm);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export class InFlightError extends Error {
  constructor() {
    super("Ephemeroi cycle already in flight");
    this.name = "InFlightError";
  }
}

export const ephemeroiLoop: EphemeroiLoop = new EphemeroiLoop();
