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
  listContradictions,
  insertReport,
  markReportDelivered,
  applySourceStateDelta,
  type ObservationRow,
  type SourceRow,
} from "./store";
import { ingestSource } from "./ingest";
import { reflectOnObservation } from "./reflect";
import { runDiscovery } from "./discover";
import { sendTelegramReport, isTelegramConfigured } from "./telegram";
import { composeConstellationAlert } from "./constellation";
import { bus } from "./bus";
import { publishSignal } from "../../lib/signal-envelope";
import {
  observationToWire,
  beliefToWire,
  contradictionToWire,
  reportToWire,
  sourceToWire,
  sourceStateToWire,
} from "./wire";

/**
 * Reports at or above this importance fire a Constellation alert (Don
 * voice + four-axis snapshot) instead of a plain Telegram report. The
 * threshold is intentionally above the default report threshold (~0.55)
 * so the user only feels the cinematic version when something genuinely
 * shifted the picture.
 */
const CONSTELLATION_THRESHOLD = Number(
  process.env["EPHEMEROI_CONSTELLATION_THRESHOLD"] ?? 0.75,
);

const NOVELTY_SAMPLE_SIZE = 200;
const MAX_REFLECTIONS_PER_CYCLE = 6;

export interface CycleResult {
  observationsAdded: number;
  beliefsUpdated: number;
  contradictionsFound: number;
  reportsCreated: number;
  /** How many new sources Ephemeroi added to itself this cycle (autonomy). */
  autoSourcesAdded: number;
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
   * Throws if a cycle is already in flight, or if the cycle itself errors —
   * so callers (e.g. the manual-trigger HTTP endpoint) can surface the
   * failure as a non-200 instead of returning misleading zero counts.
   */
  async runOnce(): Promise<CycleResult> {
    if (this.inFlight) throw new InFlightError();
    return this.cycle({ throwOnError: true });
  }

  private async scheduleNext(): Promise<void> {
    let intervalSeconds = this.currentIntervalSeconds;
    try {
      const settings = await getSettings();
      intervalSeconds = settings.intervalSeconds;
      this.currentIntervalSeconds = Math.max(1, intervalSeconds);
    } catch (err) {
      logger.warn({ err }, "Ephemeroi loop: failed to read settings");
    }
    const delay = Math.max(1_000, Math.min(intervalSeconds * 1000, 60_000));
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

  private async cycle(
    options: { throwOnError?: boolean } = {},
  ): Promise<CycleResult> {
    this.inFlight = true;
    const startedAt = Date.now();
    const ranAt = new Date(startedAt);
    let observationsAdded = 0;
    let beliefsUpdated = 0;
    let contradictionsFound = 0;
    let reportsCreated = 0;
    let autoSourcesAdded = 0;
    let cycleError: Error | null = null;
    try {
      const settings = await getSettings();

      // 1. Pull fresh observations from every active source.
      const sources = await listSources();
      const sourceById = new Map<number, SourceRow>();
      for (const s of sources) sourceById.set(s.id, s);
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

      const noveltyWeight = clamp(settings.noveltyWeight, 0, 1);

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

          // Blend the LLM's importance with the embedding-derived novelty
          // signal so the user-tunable noveltyWeight setting actually has an
          // effect on which observations cross the report threshold.
          const blendedImportance = clamp(
            reflection.importance * (1 - noveltyWeight) +
              obs.novelty * noveltyWeight,
            0,
            1,
          );

          // Apply belief updates.
          for (const upd of reflection.beliefUpdates) {
            const updatedBelief = await upsertBelief({
              proposition: upd.proposition,
              deltaConfidence: upd.deltaConfidence,
              embedding: obs.embedding,
              originSourceId: obs.sourceId,
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
          await markObservationReflected(obs.id, blendedImportance);
          obs.importance = blendedImportance;
          obs.reflected = true;
          obs.reflectedAt = new Date();
          bus.publish({ type: "observation", payload: observationToWire(obs) });

          // Apply state vector delta if the reflector flagged real movement
          // and the observation is anchored to a *currently existing* source.
          // We do this BEFORE creating the report so the constellation alert
          // can show the *new* vector + the just-applied delta.
          //
          // Orphan guard: source_id is FK-less by design (so deleting a
          // source doesn't cascade-destroy its history), which means an
          // observation can survive its parent source. If we let
          // applySourceStateDelta run on an orphan, we'd accumulate a zombie
          // ephemeroi_source_state row with no UI, no Constellation
          // delivery, and no way to clean up — exactly the silent failure
          // mode that motivated this guard. So when the source row is gone
          // we LOG the orphan loudly and skip both state mutation and the
          // Constellation path; the plain report still ships.
          let updatedSourceState: Awaited<
            ReturnType<typeof applySourceStateDelta>
          > | null = null;
          const sourceExists =
            obs.sourceId !== null && sourceById.has(obs.sourceId);
          if (
            obs.sourceId !== null &&
            !sourceExists &&
            (reflection.stateDelta || blendedImportance >= CONSTELLATION_THRESHOLD)
          ) {
            logger.warn(
              {
                observationId: obs.id,
                orphanSourceId: obs.sourceId,
                orphanSourceLabel: obs.sourceLabel,
                blendedImportance,
              },
              "Orphan observation: parent source has been deleted; skipping state-delta + constellation path. Re-anchor or delete the observation to restore alerts.",
            );
          }
          if (reflection.stateDelta && sourceExists) {
            try {
              updatedSourceState = await applySourceStateDelta({
                sourceId: obs.sourceId!,
                delta: reflection.stateDelta,
                observationId: obs.id,
                insight: reflection.insight,
              });
              bus.publish({
                type: "source_state",
                payload: sourceStateToWire(updatedSourceState),
              });
            } catch (err) {
              logger.warn(
                { err, observationId: obs.id, sourceId: obs.sourceId },
                "Failed to apply source state delta",
              );
            }
          }

          // Possibly create a report.
          if (blendedImportance >= settings.importanceThreshold) {
            const report = await insertReport({
              importance: blendedImportance,
              headline: reflection.headline,
              body: reflection.message,
              observationIds: [obs.id],
            });
            reportsCreated += 1;

            // Decide delivery path. Constellation if (a) we cleared the
            // higher threshold and (b) we have a source row to anchor it
            // to. Otherwise the original simple Telegram report.
            const sourceRow =
              obs.sourceId !== null ? sourceById.get(obs.sourceId) ?? null : null;
            const useConstellation =
              blendedImportance >= CONSTELLATION_THRESHOLD &&
              sourceRow !== null &&
              updatedSourceState !== null;

            if (useConstellation) {
              try {
                const alert = await composeConstellationAlert({
                  report,
                  sourceLabel: sourceRow!.label,
                  sourceTarget: sourceRow!.target,
                  state: updatedSourceState!,
                });
                // Always log the formatted alert — that's our audit trail
                // even when Telegram isn't configured / fails.
                logger.info(
                  {
                    reportId: report.id,
                    sourceId: sourceRow!.id,
                    importance: blendedImportance,
                    donSource: alert.donSource,
                  },
                  `Constellation alert\n${alert.formatted}`,
                );
                bus.publish({ type: "constellation_alert", payload: alert });
                // Hand off to the unified Telegram convergence layer. The
                // formatted Don/state-vector block rides along in
                // `evidence.formatted` so the convergence subscriber can
                // emit it verbatim under the `[Ephemeroi · structural]`
                // badge (or fold it into a cross-limb merge).
                //
                // The `onDelivered` callback is invoked exactly once when
                // the convergence layer knows the Telegram outcome —
                // whether this envelope was sent stand-alone or merged
                // with a Metacog counterpart. We only mark the report
                // delivered on a CONFIRMED Telegram success, so the
                // Reports view reflects actual delivery (not just hand-off).
                if (settings.telegramEnabled) {
                  const reportId = report.id;
                  publishSignal(
                    {
                      origin: "ephemeroi",
                      role: "structural",
                      severity: blendedImportance,
                      headline: report.headline,
                      body: report.body,
                      subject: `${sourceRow!.kind}:${sourceRow!.target}`,
                      evidence: {
                        formatted: alert.formatted,
                        sourceLabel: sourceRow!.label,
                        sourceTarget: sourceRow!.target,
                        sourceKind: sourceRow!.kind,
                        reportId: reportId,
                        donSource: alert.donSource,
                      },
                    },
                    {
                      onDelivered: (success) => {
                        if (!success) return;
                        markReportDelivered(reportId).catch((err) => {
                          logger.warn(
                            { err, reportId },
                            "convergence ack: markReportDelivered failed",
                          );
                        });
                      },
                    },
                  );
                }
              } catch (err) {
                logger.warn(
                  { err, reportId: report.id },
                  "Constellation composition failed; falling back to plain report",
                );
                if (settings.telegramEnabled && isTelegramConfigured()) {
                  const ok = await sendTelegramReport(report);
                  if (ok) {
                    await markReportDelivered(report.id);
                    report.delivered = true;
                    report.deliveredAt = new Date();
                  }
                }
              }
            } else if (settings.telegramEnabled && isTelegramConfigured()) {
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

      // 4. Autonomy: let the bot decide whether any GitHub references in the
      //    observations it just reflected on are worth following. Only
      //    looks at the observations from THIS cycle so it doesn't keep
      //    re-evaluating old ones forever. Failures here are isolated —
      //    discovery errors must never break the rest of the cycle.
      if (settings.autonomyEnabled && unreflected.length > 0) {
        try {
          // Surface the bot's open questions (unresolved contradictions) so
          // discovery picks sources that go DEEPER on what it doesn't yet
          // understand, rather than piling on peers of what it already
          // knows. This is what turns autonomy from "collect lateral
          // sources" into "learn one thing at a time".
          const allContradictions = await listContradictions().catch(
            (): Awaited<ReturnType<typeof listContradictions>> => [],
          );
          const openQuestions = allContradictions
            .filter((c) => !c.resolved)
            .slice(0, 6)
            .map((c) => c.summary);
          const discovery = await runDiscovery({
            observations: unreflected,
            beliefs: beliefSummaries,
            openQuestions,
            autonomyMaxSources: settings.autonomyMaxSources,
          });
          autoSourcesAdded = discovery.added.length;
          if (autoSourcesAdded > 0) {
            // Re-list sources so we can publish wire-shape rows for the
            // newly added entries. This keeps the SSE stream consistent
            // with what /ephemeroi/sources would return.
            const allSources = await listSources();
            for (const a of discovery.added) {
              const row = allSources.find(
                (s) => s.kind === a.kind && s.target === a.target,
              );
              if (row) {
                bus.publish({
                  type: "source_auto_added",
                  payload: {
                    source: sourceToWire(row),
                    reason: a.reason,
                  },
                });
              }
            }
          }
        } catch (err) {
          // Discovery errors are non-fatal: log and move on so the rest of
          // the cycle's results still get reported.
          logger.warn({ err }, "Ephemeroi discovery failed");
        }
      }

      this.lastError = null;
    } catch (err) {
      cycleError = err instanceof Error ? err : new Error(String(err));
      this.lastError = cycleError.message;
      logger.warn({ err }, "Ephemeroi cycle failed");
    }

    this.inFlight = false;
    this.lastCycleAt = ranAt;
    const result: CycleResult = {
      observationsAdded,
      beliefsUpdated,
      contradictionsFound,
      reportsCreated,
      autoSourcesAdded,
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
        autoSourcesAdded: result.autoSourcesAdded,
        ranAt: result.ranAt.toISOString(),
        durationMs: result.durationMs,
      },
    });
    if (cycleError && options.throwOnError) {
      throw cycleError;
    }
    return result;
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
