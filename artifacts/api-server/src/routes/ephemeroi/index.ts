import { Router, type IRouter } from "express";
import {
  GetEphemeroiStateResponse,
  GetEphemeroiSettingsResponse,
  UpdateEphemeroiSettingsBody,
  UpdateEphemeroiSettingsResponse,
  ListEphemeroiSourcesResponse,
  CreateEphemeroiSourceBody,
  DeleteEphemeroiSourceParams,
  ListEphemeroiObservationsQueryParams,
  ListEphemeroiObservationsResponse,
  ListEphemeroiBeliefsResponse,
  TrimEphemeroiBeliefBody,
  TrimEphemeroiBeliefResponse,
  ListEphemeroiTopicBeliefsResponse,
  ListEphemeroiTopicBeliefsQueryParams,
  GetEphemeroiCognitiveFieldResponse,
  ListEphemeroiContradictionsResponse,
  ListEphemeroiReportsQueryParams,
  ListEphemeroiReportsResponse,
  RunEphemeroiCycleResponse,
  RunEphemeroiSelfImprovementResponse,
  RunEphemeroiBiomimeticBody,
  RunEphemeroiBiomimeticResponse,
  StreamEphemeroiSourceParams,
  StreamEphemeroiSourceResponse,
  ListEphemeroiSpectralOperatorsResponse,
  GetEphemeroiSpectralStateResponse,
  InvokeEphemeroiSpectralOperatorBody,
  InvokeEphemeroiSpectralOperatorResponse,
  ListEphemeroiSpectralInvocationsQueryParams,
  ListEphemeroiSpectralInvocationsResponse,
} from "@workspace/api-zod";
import { runSelfImprovement, SelfImproveInFlightError } from "./selfImprove";
import { runStreamIngest } from "./stream-ingest";
import { runBiomimetic } from "./biomimetic";
import {
  getSettings,
  updateSettings,
  listSources,
  listSourceStates,
  createSource,
  deleteSource,
  listRecentObservations,
  listBeliefs,
  deleteBelief,
  trimBelief,
  listBeliefsBySource,
  listTopicBeliefs,
  listContradictions,
  listRecentReports,
  type SourceKind,
} from "./store";
import {
  getCognitiveField,
  getCognitiveMood,
  decayHalfLifeMultiplier,
} from "./cognitiveField";
import { parseRepoTarget, parseUserTarget } from "../../lib/github-client";
import {
  observationToWire,
  beliefToWire,
  contradictionToWire,
  reportToWire,
  sourceToWire,
  sourceStateToWire,
  settingsToWire,
  topicBeliefToWire,
} from "./wire";
import { ephemeroiLoop, InFlightError } from "./loop";
import { startTelegramAnswerLoop } from "./telegramAnswer";
import { startConvergence } from "./convergence";
import { startTopicBeliefDecayLoop } from "./topicBeliefDecayLoop";
import {
  startSelfBuildLoop,
  runOneCycle as runSelfBuildCycle,
  getSelfBuildStatus,
} from "./spectral/self-build-loop";
import { bus, type EphemeroiEvent } from "./bus";
import { assertPublicHttpUrl } from "./guard";
import { logger } from "../../lib/logger";
import {
  SignalEnvelopeSchema,
  publishSignal,
} from "../../lib/signal-envelope";

const router: IRouter = Router();

// Kick off the always-on loop the first time this module is loaded.
ephemeroiLoop.start();
// Start listening for inbound Telegram questions (no-op if Telegram unconfigured).
startTelegramAnswerLoop();
// Wire the unified Telegram convergence layer to the cross-site signal bus.
// All in-process publishSignal() calls (Ephemeroi structural alerts +
// Metacog truth-anchor / exploration) now flow through this subscriber so
// they pick up `[Origin · role]` badges + cross-limb merging.
startConvergence();
// Background passive-decay loop for autonomous topic beliefs. Drifts every
// opinion toward neutral 0.5 with a half-life modulated by the cognitive
// field (settled → slower decay, contested/oscillating → faster).
startTopicBeliefDecayLoop();
// Optional autonomous spectral self-build loop. OFF by default — opt in
// with `EPHEMEROI_SPECTRAL_SELF_BUILD=1`. Each cycle composes
// ["Energy", "Gravity"] then (gated on real effect) ["Light", "Prism"]
// via the SpectralRegistry, persisting every step.
if (process.env["EPHEMEROI_SPECTRAL_SELF_BUILD"] === "1") {
  const intervalMs = Number(
    process.env["EPHEMEROI_SPECTRAL_SELF_BUILD_INTERVAL_MS"] ?? "60000",
  );
  startSelfBuildLoop({
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60_000,
  });
}

// ===== State (one-shot dashboard) =====

router.get("/ephemeroi/state", async (_req, res) => {
  try {
    const [settings, sources, observations, beliefs, contradictions, reports] =
      await Promise.all([
        getSettings(),
        listSources(),
        listRecentObservations(40),
        listBeliefs(),
        listContradictions(),
        listRecentReports(20),
      ]);
    const status = ephemeroiLoop.status();
    const data = GetEphemeroiStateResponse.parse({
      settings: settingsToWire(settings),
      sources: sources.map(sourceToWire),
      recentObservations: observations.map(observationToWire),
      beliefs: beliefs.map(beliefToWire),
      contradictions: contradictions.map(contradictionToWire),
      recentReports: reports.map(reportToWire),
      loop: {
        running: status.running,
        lastCycleAt: status.lastCycleAt
          ? status.lastCycleAt.toISOString()
          : null,
        nextCycleAt: status.nextCycleAt
          ? status.nextCycleAt.toISOString()
          : null,
        lastError: status.lastError,
      },
    });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/state failed");
    res.status(500).json({ error: "Failed to load explorer state" });
  }
});

// ===== Settings =====

router.get("/ephemeroi/settings", async (_req, res) => {
  try {
    const s = await getSettings();
    res.json(GetEphemeroiSettingsResponse.parse(settingsToWire(s)));
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/settings failed");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/ephemeroi/settings", async (req, res) => {
  const parsed = UpdateEphemeroiSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const updated = await updateSettings(parsed.data);
    res.json(UpdateEphemeroiSettingsResponse.parse(settingsToWire(updated)));
  } catch (err) {
    logger.error({ err }, "PUT /ephemeroi/settings failed");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ===== Sources =====

router.get("/ephemeroi/sources", async (_req, res) => {
  try {
    const sources = await listSources();
    res.json(
      ListEphemeroiSourcesResponse.parse({
        sources: sources.map(sourceToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/sources failed");
    res.status(500).json({ error: "Failed to list sources" });
  }
});

router.get("/ephemeroi/source-states", async (_req, res) => {
  try {
    const states = await listSourceStates();
    res.json({ states: states.map(sourceStateToWire) });
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/source-states failed");
    res.status(500).json({ error: "Failed to list source states" });
  }
});

router.post("/ephemeroi/sources", async (req, res) => {
  const parsed = CreateEphemeroiSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.kind === "rss" || parsed.data.kind === "url") {
    try {
      await assertPublicHttpUrl(parsed.data.target);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : "target must be a valid public http(s) URL for rss/url sources",
      });
      return;
    }
  }
  // Canonicalize github targets so dedup + bridge lookups work. github = a
  // single repo ("owner/repo"); github_user = a whole user/org ("username")
  // whose owned public repos are watched as a single fan-out source.
  let target = parsed.data.target;
  if (parsed.data.kind === "github") {
    const repo = parseRepoTarget(target);
    if (!repo) {
      res.status(400).json({
        error: "github target must be \"owner/repo\" or a github.com URL",
      });
      return;
    }
    target = repo.canonical;
  } else if (parsed.data.kind === "github_user") {
    const user = parseUserTarget(target);
    if (!user) {
      res.status(400).json({
        error: "github_user target must be a username or a github.com/<user> URL",
      });
      return;
    }
    target = user.canonical;
  }
  try {
    const created = await createSource({
      kind: parsed.data.kind as SourceKind,
      target,
      label: parsed.data.label ?? undefined,
    });
    res.status(201).json(sourceToWire(created));
  } catch (err) {
    logger.error({ err }, "POST /ephemeroi/sources failed");
    res.status(500).json({ error: "Failed to create source" });
  }
});

// ===== Bridge: beliefs by source =====
// Used by Metacog to ask Ephemeroi what it currently believes about a watched
// surface (e.g. a GitHub repo). Read-only, no auth — mirrors the rest of
// /api/ephemeroi which is already public on this server.
router.get("/ephemeroi/beliefs/by-source", async (req, res) => {
  const kindRaw = req.query["kind"];
  const targetRaw = req.query["target"];
  if (typeof kindRaw !== "string" || typeof targetRaw !== "string") {
    res.status(400).json({ error: "kind and target query params required" });
    return;
  }
  const allowed: ReadonlyArray<SourceKind> = ["rss", "url", "search", "github", "github_user", "gh_archive"];
  if (!allowed.includes(kindRaw as SourceKind)) {
    res.status(400).json({ error: `invalid kind, expected one of ${allowed.join(", ")}` });
    return;
  }
  let target = targetRaw;
  if (kindRaw === "github") {
    const repo = parseRepoTarget(targetRaw);
    if (!repo) {
      res.status(400).json({ error: "invalid github target" });
      return;
    }
    target = repo.canonical;
  } else if (kindRaw === "github_user") {
    const user = parseUserTarget(targetRaw);
    if (!user) {
      res.status(400).json({ error: "invalid github_user target" });
      return;
    }
    target = user.canonical;
  }
  try {
    const result = await listBeliefsBySource(kindRaw as SourceKind, target);
    res.json({
      source: result.source ? sourceToWire(result.source) : null,
      beliefs: result.beliefs.map(beliefToWire),
      contradictions: result.contradictions.map((c) => ({
        id: c.id,
        summary: c.summary,
        resolved: c.resolved,
        detectedAt: c.detectedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/beliefs/by-source failed");
    res.status(500).json({ error: "Failed to load beliefs by source" });
  }
});

// ===== Inbound cross-site signal endpoint =====
// Accepts a SignalEnvelope POSTed from another site (currently Metacog when
// it runs out of process). Validates against `EPHEMEROI_SIGNAL_SECRET` and
// re-publishes onto the in-process bus, so the unified Telegram convergence
// layer routes it identically to in-process signals.
//
// Same-process Metacog adapters (search/truth-anchor + search/exploration)
// already publish directly to the bus; this endpoint exists so a future split
// deployment doesn't break the unified stream.
router.post("/ephemeroi/signal", (req, res): void => {
  const expected = process.env["EPHEMEROI_SIGNAL_SECRET"];
  if (!expected) {
    res.status(503).json({
      error:
        "Inbound signal endpoint disabled — set EPHEMEROI_SIGNAL_SECRET to enable",
    });
    return;
  }
  const headerRaw = req.header("x-ephemeroi-signal-secret");
  if (!headerRaw || headerRaw !== expected) {
    res
      .status(401)
      .json({ error: "Missing or invalid x-ephemeroi-signal-secret header" });
    return;
  }
  const parsed = SignalEnvelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid signal envelope",
      issues: parsed.error.issues
        .slice(0, 5)
        .map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  publishSignal(parsed.data);
  res.status(202).json({
    accepted: true,
    origin: parsed.data.origin,
    role: parsed.data.role,
  });
});

router.delete("/ephemeroi/sources/:id", async (req, res) => {
  const parsed = DeleteEphemeroiSourceParams.safeParse({
    id: Number(req.params["id"]),
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const ok = await deleteSource(parsed.data.id);
    if (!ok) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "DELETE /ephemeroi/sources failed");
    res.status(500).json({ error: "Failed to delete source" });
  }
});

// ===== Stream ingest (on-demand) =====

router.post("/ephemeroi/sources/:id/stream", async (req, res) => {
  const parsed = StreamEphemeroiSourceParams.safeParse({
    id: Number(req.params["id"]),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid source ID" });
    return;
  }
  try {
    // Look up the source — use the full list (sources table is small).
    const all = await listSources();
    const source = all.find((s) => s.id === parsed.data.id);
    if (!source) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    if (!source.active) {
      res.status(400).json({ error: "Source is inactive — activate it first" });
      return;
    }
    const result = await runStreamIngest(source);
    const wireObs = result.added.map(observationToWire);
    const response = StreamEphemeroiSourceResponse.parse({
      addedCount: result.added.length,
      bytesRead: result.bytesRead,
      unitsInterpreted: result.unitsInterpreted,
      errors: result.errors,
      observations: wireObs,
    });
    const statusCode = result.errors.length > 0 && result.added.length === 0 ? 503 : 200;
    res.status(statusCode).json(response);
  } catch (err) {
    logger.error({ err }, "POST /ephemeroi/sources/:id/stream failed");
    res.status(500).json({ error: "Streaming ingest failed" });
  }
});

// ===== Observations =====

router.get("/ephemeroi/observations", async (req, res) => {
  const limitRaw = req.query["limit"];
  const params = ListEphemeroiObservationsQueryParams.safeParse({
    limit: limitRaw === undefined ? undefined : Number(limitRaw),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const obs = await listRecentObservations(params.data.limit ?? 50);
    res.json(
      ListEphemeroiObservationsResponse.parse({
        observations: obs.map(observationToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/observations failed");
    res.status(500).json({ error: "Failed to list observations" });
  }
});

// ===== Beliefs =====

router.delete("/ephemeroi/beliefs/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid belief id" });
    return;
  }
  try {
    const ok = await deleteBelief(id);
    if (!ok) {
      res.status(404).json({ error: "Belief not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err, id }, "DELETE /ephemeroi/beliefs/:id failed");
    res.status(500).json({ error: "Failed to delete belief" });
  }
});

router.post("/ephemeroi/beliefs/:id/trim", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid belief id" });
    return;
  }
  const parsed = TrimEphemeroiBeliefBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const updated = await trimBelief(id, parsed.data.keepFraction);
    if (!updated) {
      res.status(404).json({ error: "Belief not found" });
      return;
    }
    res.json(
      TrimEphemeroiBeliefResponse.parse({ belief: beliefToWire(updated) }),
    );
  } catch (err) {
    logger.error({ err, id }, "POST /ephemeroi/beliefs/:id/trim failed");
    res.status(500).json({ error: "Failed to trim belief" });
  }
});

router.get("/ephemeroi/beliefs", async (_req, res) => {
  try {
    const beliefs = await listBeliefs();
    res.json(
      ListEphemeroiBeliefsResponse.parse({
        beliefs: beliefs.map(beliefToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/beliefs failed");
    res.status(500).json({ error: "Failed to list beliefs" });
  }
});

router.get("/ephemeroi/topic-beliefs", async (req, res) => {
  // Use safeParse so a bad ?limit= becomes a 400, matching the rest of the
  // ephemeroi routes (a parse throw would otherwise be hidden by the broad
  // catch below as a 500).
  const parsed = ListEphemeroiTopicBeliefsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  try {
    const beliefs = await listTopicBeliefs(parsed.data.limit ?? 100);
    res.json(
      ListEphemeroiTopicBeliefsResponse.parse({
        beliefs: beliefs.map(topicBeliefToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/topic-beliefs failed");
    res.status(500).json({ error: "Failed to list topic beliefs" });
  }
});

router.get("/ephemeroi/cognitive-field", async (_req, res) => {
  // Public read of the in-process cognitive field snapshot. No DB I/O —
  // this is just exposing the most recent biomimetic-run summary so the
  // dashboard can display the substrate state alongside the opinions
  // that depend on it. Returns a stable shape even when no run has
  // happened yet (mood "neutral", multiplier 1.0, snapshot null).
  try {
    const snap = getCognitiveField();
    res.json(
      GetEphemeroiCognitiveFieldResponse.parse({
        mood: getCognitiveMood(),
        decayMultiplier: decayHalfLifeMultiplier(),
        snapshot: snap
          ? {
              consensusMean: snap.consensusMean,
              turbulence: snap.turbulence,
              conflict: snap.conflict,
              solved: snap.solved,
              capturedAt: snap.capturedAt.toISOString(),
            }
          : null,
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/cognitive-field failed");
    res.status(500).json({ error: "Failed to read cognitive field" });
  }
});

// ===== Contradictions =====

router.get("/ephemeroi/contradictions", async (_req, res) => {
  try {
    const contradictions = await listContradictions();
    res.json(
      ListEphemeroiContradictionsResponse.parse({
        contradictions: contradictions.map(contradictionToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/contradictions failed");
    res.status(500).json({ error: "Failed to list contradictions" });
  }
});

// ===== Reports =====

router.get("/ephemeroi/reports", async (req, res) => {
  const limitRaw = req.query["limit"];
  const params = ListEphemeroiReportsQueryParams.safeParse({
    limit: limitRaw === undefined ? undefined : Number(limitRaw),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const reports = await listRecentReports(params.data.limit ?? 50);
    res.json(
      ListEphemeroiReportsResponse.parse({
        reports: reports.map(reportToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/reports failed");
    res.status(500).json({ error: "Failed to list reports" });
  }
});

// ===== Trigger one cycle =====

router.post("/ephemeroi/cycle/run", async (_req, res) => {
  try {
    const result = await ephemeroiLoop.runOnce();
    res.json(
      RunEphemeroiCycleResponse.parse({
        observationsAdded: result.observationsAdded,
        beliefsUpdated: result.beliefsUpdated,
        contradictionsFound: result.contradictionsFound,
        reportsCreated: result.reportsCreated,
        autoSourcesAdded: result.autoSourcesAdded,
        ranAt: result.ranAt.toISOString(),
        durationMs: result.durationMs,
      }),
    );
  } catch (err) {
    if (err instanceof InFlightError) {
      res.status(409).json({ error: "A cycle is already running" });
      return;
    }
    logger.error({ err }, "POST /ephemeroi/cycle/run failed");
    res.status(500).json({ error: "Cycle failed" });
  }
});

// ===== Self-improvement =====
// Lets Ephemeroi read, edit, and re-bundle its own routes/* source files
// (whitelisted in selfImprove.ts), then ping Telegram with the rationale.
// The change won't take effect until the api-server process is restarted —
// the Telegram message says so explicitly. If the patched code fails to
// build, the original is restored automatically and the failure is reported.
router.post("/ephemeroi/biomimetic", async (req, res) => {
  // Parse first; a zod failure here is a client error (400), not a 500.
  const parsed = RunEphemeroiBiomimeticBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  try {
    const result = await runBiomimetic(parsed.data);
    res.json(RunEphemeroiBiomimeticResponse.parse(result));
  } catch (err) {
    logger.error({ err }, "POST /ephemeroi/biomimetic failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/ephemeroi/self-improve", async (_req, res) => {
  try {
    const result = await runSelfImprovement();
    res.json(RunEphemeroiSelfImprovementResponse.parse(result));
  } catch (err) {
    if (err instanceof SelfImproveInFlightError) {
      res.status(409).json({ error: "A self-improvement is already in flight" });
      return;
    }
    logger.error({ err }, "POST /ephemeroi/self-improve failed");
    res.status(500).json({ error: "Self-improvement failed" });
  }
});

// ===== Spectral-Skills Layer =====

router.get("/ephemeroi/spectral/operators", async (_req, res) => {
  try {
    const { listOperators } = await import("./spectral/operators");
    const operators = listOperators().map((op) => ({
      name: op.name,
      signature: op.signature,
      planet: op.planet,
      personaWeights: op.personaWeights,
      expectedEffect: op.expectedEffect,
      description: op.description,
    }));
    res.json(
      ListEphemeroiSpectralOperatorsResponse.parse({ operators }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/spectral/operators failed");
    res.status(500).json({ error: "Failed to list spectral operators" });
  }
});

router.get("/ephemeroi/spectral/state", async (_req, res) => {
  try {
    const { computePhaseState } = await import("./spectral/phaseState");
    const phaseState = await computePhaseState();
    res.json(GetEphemeroiSpectralStateResponse.parse({ phaseState }));
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/spectral/state failed");
    res.status(500).json({ error: "Failed to compute phase state" });
  }
});

router.post("/ephemeroi/spectral/invoke", async (req, res) => {
  const parsed = InvokeEphemeroiSpectralOperatorBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { invokeOperator } = await import("./spectral/runner");
    const invocation = await invokeOperator(parsed.data.operator);
    res.json(
      InvokeEphemeroiSpectralOperatorResponse.parse({
        invocation: invocationToWire(invocation),
      }),
    );
    // Surface the operator move on the SSE bus so the UI can refresh
    // without polling. We re-use the generic "belief" channel — operators
    // that mutate beliefs already publish there in their actions; this
    // is just the umbrella audit signal.
    bus.publish({
      type: "spectral",
      payload: invocationToWire(invocation),
    } as unknown as EphemeroiEvent);
    return;
  } catch (err) {
    if (err instanceof Error && err.name === "UnknownOperatorError") {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "POST /ephemeroi/spectral/invoke failed");
    res.status(500).json({ error: "Failed to invoke spectral operator" });
  }
});

router.get("/ephemeroi/spectral/invocations", async (req, res) => {
  const parsed = ListEphemeroiSpectralInvocationsQueryParams.safeParse(
    req.query,
  );
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  try {
    const { listInvocations } = await import("./spectral/store");
    const invocations = await listInvocations(parsed.data.limit ?? 50);
    res.json(
      ListEphemeroiSpectralInvocationsResponse.parse({
        invocations: invocations.map(invocationToWire),
      }),
    );
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/spectral/invocations failed");
    res.status(500).json({ error: "Failed to list invocations" });
  }
});

// ===== Spectral self-build loop =====

router.get("/ephemeroi/spectral/self-build/status", (_req, res) => {
  try {
    const status = getSelfBuildStatus();
    res.json({
      enabled: status.enabled,
      intervalMs: status.intervalMs,
      cycleCount: status.cycleCount,
      startedAt: status.startedAt,
      lastCycleAt: status.lastCycleAt,
      lastCycleResult: status.lastCycleResult,
      lastInvocations: status.lastInvocations.map(invocationToWire),
    });
  } catch (err) {
    logger.error({ err }, "GET /ephemeroi/spectral/self-build/status failed");
    res.status(500).json({ error: "Failed to read self-build status" });
  }
});

router.post("/ephemeroi/spectral/self-build/trigger", async (_req, res) => {
  try {
    const { result, invocations } = await runSelfBuildCycle({
      reasonPrefix: "[manual trigger]",
    });
    res.json({
      result,
      invocations: invocations.map(invocationToWire),
    });
  } catch (err) {
    logger.error({ err }, "POST /ephemeroi/spectral/self-build/trigger failed");
    res.status(500).json({ error: "Failed to run self-build cycle" });
  }
});

// Local helper — collapses Date → ISO and shapes the InvocationRecord into
// the OpenAPI-typed wire shape. Kept local to keep wire.ts focused on the
// existing observation/belief/contradiction/etc. wires.
function invocationToWire(
  inv: import("./spectral/types").InvocationRecord,
): {
  id: number;
  operator: string;
  signature: import("./spectral/types").SpectralPhase[];
  planet: import("./spectral/types").SpectralPhase;
  personaWeights: import("./spectral/types").PersonaWeights;
  selectionReason: string | null;
  phaseStateBefore: import("./spectral/types").PhaseState;
  phaseStateAfter: import("./spectral/types").PhaseState | null;
  effect: Record<string, unknown>;
  narration: string;
  success: boolean;
  error: string | null;
  invokedAt: string;
} {
  return {
    id: inv.id,
    operator: inv.operator,
    signature: inv.signature,
    planet: inv.planet,
    personaWeights: inv.personaWeights,
    selectionReason: inv.selectionReason,
    phaseStateBefore: inv.phaseStateBefore,
    phaseStateAfter: inv.phaseStateAfter,
    effect: inv.effect,
    narration: inv.narration,
    success: inv.success,
    error: inv.error,
    invokedAt: inv.invokedAt.toISOString(),
  };
}

// ===== SSE: live event stream =====
// NB: This route is intentionally outside the OpenAPI spec — SSE is not a
// great fit for OpenAPI codegen. The frontend uses native EventSource.

router.get("/ephemeroi/stream", (_req, res) => {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  const writeEvent = (ev: EphemeroiEvent) => {
    try {
      // Emit on the default `message` channel as a `{type, payload}`
      // envelope so the browser's EventSource.onmessage handler picks it up
      // without per-type addEventListener wiring.
      res.write(`data: ${JSON.stringify({ type: ev.type, payload: ev.payload })}\n\n`);
    } catch (err) {
      logger.debug({ err }, "Failed to write SSE event");
    }
  };

  // Initial hello so the client knows we're connected.
  res.write(
    `data: ${JSON.stringify({
      type: "hello",
      payload: { at: new Date().toISOString() },
    })}\n\n`,
  );

  const onEvent = (ev: EphemeroiEvent) => writeEvent(ev);
  bus.on("event", onEvent);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignored
    }
  }, 25_000);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    bus.off("event", onEvent);
  };
  // Bind to the response so we react to true client disconnect, not request
  // body completion (which fires immediately for GET requests in some
  // Express/Node configurations).
  res.on("close", cleanup);
  res.on("error", cleanup);
});

export default router;
