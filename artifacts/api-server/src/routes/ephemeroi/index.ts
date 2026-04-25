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
  ListEphemeroiContradictionsResponse,
  ListEphemeroiReportsQueryParams,
  ListEphemeroiReportsResponse,
  RunEphemeroiCycleResponse,
} from "@workspace/api-zod";
import {
  getSettings,
  updateSettings,
  listSources,
  createSource,
  deleteSource,
  listRecentObservations,
  listBeliefs,
  listContradictions,
  listRecentReports,
  type SourceKind,
} from "./store";
import {
  observationToWire,
  beliefToWire,
  contradictionToWire,
  reportToWire,
  sourceToWire,
  settingsToWire,
} from "./wire";
import { ephemeroiLoop, InFlightError } from "./loop";
import { bus, type EphemeroiEvent } from "./bus";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// Kick off the always-on loop the first time this module is loaded.
ephemeroiLoop.start();

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

router.post("/ephemeroi/sources", async (req, res) => {
  const parsed = CreateEphemeroiSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.kind === "rss" || parsed.data.kind === "url") {
    try {
      // basic validation
      // eslint-disable-next-line no-new
      new URL(parsed.data.target);
    } catch {
      res
        .status(400)
        .json({ error: "target must be a valid URL for rss/url sources" });
      return;
    }
  }
  try {
    const created = await createSource({
      kind: parsed.data.kind as SourceKind,
      target: parsed.data.target,
      label: parsed.data.label ?? undefined,
    });
    res.status(201).json(sourceToWire(created));
  } catch (err) {
    logger.error({ err }, "POST /ephemeroi/sources failed");
    res.status(500).json({ error: "Failed to create source" });
  }
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

// ===== SSE: live event stream =====
// NB: This route is intentionally outside the OpenAPI spec — SSE is not a
// great fit for OpenAPI codegen. The frontend uses native EventSource.

router.get("/ephemeroi/stream", (req, res) => {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  const writeEvent = (ev: EphemeroiEvent) => {
    try {
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev.payload)}\n\n`);
    } catch (err) {
      logger.debug({ err }, "Failed to write SSE event");
    }
  };

  // Initial hello so the client knows we're connected.
  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const onEvent = (ev: EphemeroiEvent) => writeEvent(ev);
  bus.on("event", onEvent);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignored
    }
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off("event", onEvent);
  };
  req.on("close", cleanup);
  req.on("end", cleanup);
});

export default router;
