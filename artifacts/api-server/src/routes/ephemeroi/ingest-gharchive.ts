import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { logger } from "../../lib/logger";
import {
  insertObservationIfNew,
  getSourceCursor,
  updateSourceCursor,
  type SourceRow,
  type ObservationRow,
} from "./store";

// gh_archive: stream-decode hourly GH Archive dumps from
// https://data.gharchive.org/YYYY-MM-DD-H.json.gz, narrowed by a filter
// stored in source.target. One hour per cycle. Cursor: { lastFetchedHour }.

const MAX_DOWNLOADED_BYTES = 120 * 1024 * 1024;
const MAX_EVENTS_PARSED = 300_000;
const MAX_OBSERVATIONS_PER_CYCLE = 25;
const PUBLISH_LAG_HOURS = 2;
const FETCH_TIMEOUT_MS = 90_000;

interface GhArchiveCursor {
  lastFetchedHour?: string;
}

interface GhEvent {
  id?: string;
  type?: string;
  actor?: { login?: string };
  repo?: { name?: string };
  org?: { login?: string };
  payload?: unknown;
  created_at?: string;
}

// Filter mini-DSL: comma-separated `key:value` pairs, AND-combined.
//   repo:facebook/        repo full_name prefix
//   event:ReleaseEvent    exact event type
//   org:nodejs            owner / org login
interface ParsedFilter {
  repos: string[];
  events: string[];
  orgs: string[];
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function asArr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function parseFilter(target: string): ParsedFilter {
  const f: ParsedFilter = { repos: [], events: [], orgs: [] };
  for (const raw of target.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (!v) continue;
    if (k === "repo") f.repos.push(v.toLowerCase());
    else if (k === "event") f.events.push(v);
    else if (k === "org") f.orgs.push(v.toLowerCase());
  }
  return f;
}

function eventMatches(ev: GhEvent, f: ParsedFilter): boolean {
  if (f.events.length > 0 && (!ev.type || !f.events.includes(ev.type))) {
    return false;
  }
  if (f.repos.length > 0) {
    const r = (ev.repo?.name ?? "").toLowerCase();
    if (!r || !f.repos.some((p) => r.startsWith(p))) return false;
  }
  if (f.orgs.length > 0) {
    const o = (
      ev.org?.login ??
      ev.repo?.name?.split("/")[0] ??
      ""
    ).toLowerCase();
    if (!o || !f.orgs.includes(o)) return false;
  }
  return true;
}

function hourKey(d: Date): string {
  return (
    `${d.getUTCFullYear()}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getUTCDate()).padStart(2, "0")}-` +
    `${d.getUTCHours()}`
  );
}

function parseHourKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{1,2})$/.exec(key);
  if (!m) throw new Error(`bad gh_archive hour key: ${key}`);
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
    ),
  );
}

function nextHour(key: string): string {
  const d = parseHourKey(key);
  d.setUTCHours(d.getUTCHours() + 1);
  return hourKey(d);
}

function archiveUrl(key: string): string {
  return `https://data.gharchive.org/${key}.json.gz`;
}

function pickTargetHour(cursor: GhArchiveCursor): string {
  if (cursor.lastFetchedHour) return nextHour(cursor.lastFetchedHour);
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - PUBLISH_LAG_HOURS);
  return hourKey(d);
}

function renderEvent(
  source: SourceRow,
  ev: GhEvent,
): Parameters<typeof insertObservationIfNew>[0] | null {
  const repo = ev.repo?.name ?? "unknown";
  const actor = ev.actor?.login ?? "unknown";
  const type = ev.type ?? "Event";
  const payload = asObj(ev.payload) ?? {};
  let title = `[${repo}] ${type} by ${actor}`;
  let snippet = `${type} on ${repo} by ${actor}`;
  let url: string | null = null;

  if (type === "PushEvent") {
    const commits = asArr(payload["commits"]) ?? [];
    const head = asStr(asObj(commits[0])?.["message"])?.split("\n")[0] ?? "";
    const ref = asStr(payload["ref"]) ?? "?";
    const count = commits.length;
    title = `[${repo}] push (${count} commit${count === 1 ? "" : "s"}) → ${ref} by ${actor}`;
    snippet =
      `${count} commit${count === 1 ? "" : "s"} pushed to ${ref}` +
      (head ? `\nHEAD: ${head}` : "");
    url = `https://github.com/${repo}/commits/${ref.replace(/^refs\/heads\//, "")}`;
  } else if (type === "PullRequestEvent") {
    const action = asStr(payload["action"]) ?? "";
    const pr = asObj(payload["pull_request"]);
    const num = asNum(pr?.["number"]) ?? "?";
    title = `[${repo}] PR ${action} #${num}: ${(asStr(pr?.["title"]) ?? "").slice(0, 140)} by ${actor}`;
    snippet = (asStr(pr?.["body"]) ?? "").slice(0, 800);
    url = asStr(pr?.["html_url"]) ?? null;
  } else if (type === "PullRequestReviewEvent") {
    const pr = asObj(payload["pull_request"]);
    const review = asObj(payload["review"]);
    title = `[${repo}] PR review (${asStr(review?.["state"]) ?? "?"}) on #${asNum(pr?.["number"]) ?? "?"} by ${actor}`;
    snippet = (asStr(review?.["body"]) ?? "").slice(0, 600);
    url = asStr(review?.["html_url"]) ?? null;
  } else if (type === "IssuesEvent") {
    const action = asStr(payload["action"]) ?? "";
    const issue = asObj(payload["issue"]);
    title = `[${repo}] issue ${action} #${asNum(issue?.["number"]) ?? "?"}: ${(asStr(issue?.["title"]) ?? "").slice(0, 140)} by ${actor}`;
    snippet = (asStr(issue?.["body"]) ?? "").slice(0, 800);
    url = asStr(issue?.["html_url"]) ?? null;
  } else if (type === "IssueCommentEvent") {
    const issue = asObj(payload["issue"]);
    const comment = asObj(payload["comment"]);
    title = `[${repo}] comment on #${asNum(issue?.["number"]) ?? "?"}: ${(asStr(issue?.["title"]) ?? "").slice(0, 120)} by ${actor}`;
    snippet = (asStr(comment?.["body"]) ?? "").slice(0, 600);
    url = asStr(comment?.["html_url"]) ?? null;
  } else if (type === "ReleaseEvent") {
    const rel = asObj(payload["release"]);
    title = `[${repo}] release: ${asStr(rel?.["name"]) ?? asStr(rel?.["tag_name"]) ?? "?"} by ${actor}`;
    snippet = (asStr(rel?.["body"]) ?? "").slice(0, 800);
    url = asStr(rel?.["html_url"]) ?? null;
  } else if (type === "ForkEvent") {
    const forkee = asObj(payload["forkee"]);
    title = `[${repo}] forked → ${asStr(forkee?.["full_name"]) ?? "?"} by ${actor}`;
    snippet = `Fork created: ${asStr(forkee?.["full_name"]) ?? "?"}`;
    url = asStr(forkee?.["html_url"]) ?? null;
  } else if (type === "WatchEvent") {
    title = `[${repo}] starred by ${actor}`;
    snippet = `${actor} starred ${repo}`;
  } else if (type === "CreateEvent") {
    const refType = asStr(payload["ref_type"]) ?? "";
    const ref = asStr(payload["ref"]) ?? "";
    title = `[${repo}] created ${refType}${ref ? ` ${ref}` : ""} by ${actor}`;
    snippet = `${refType}${ref ? ` ${ref}` : ""} created on ${repo}`;
  } else if (type === "DeleteEvent") {
    const refType = asStr(payload["ref_type"]) ?? "";
    const ref = asStr(payload["ref"]) ?? "";
    title = `[${repo}] deleted ${refType}${ref ? ` ${ref}` : ""} by ${actor}`;
    snippet = `${refType}${ref ? ` ${ref}` : ""} deleted from ${repo}`;
  }

  if (!url) url = `https://github.com/${repo}`;

  // Scope dedup by sourceId so two gh_archive sources with overlapping
  // filters each get their own observation + reflection chain.
  const evKey = ev.id
    ? ev.id
    : `${repo}:${type}:${ev.created_at ?? ""}:${actor}`;
  const urlHash = createHash("sha256")
    .update(`gha:${source.id}:${evKey}`)
    .digest("hex");

  return {
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title: title.slice(0, 240),
    snippet: snippet.slice(0, 1500),
    url,
    urlHash,
  };
}

export async function ingestGhArchive(
  source: SourceRow,
): Promise<{ added: ObservationRow[] }> {
  const filter = parseFilter(source.target);
  const cursor =
    ((await getSourceCursor(source.id)) as GhArchiveCursor | null) ?? {};
  const targetHour = pickTargetHour(cursor);

  // Skip target hours that physically can't exist yet (avoids a guaranteed 404).
  const earliest = new Date();
  earliest.setUTCHours(earliest.getUTCHours() - 1);
  if (parseHourKey(targetHour) > earliest) {
    logger.debug(
      { sourceId: source.id, targetHour },
      "GH Archive: target hour not yet published, skipping cycle",
    );
    return { added: [] };
  }

  const url = archiveUrl(targetHour);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "user-agent":
          "Ephemeroi/0.1 (autonomous explorer; +https://replit.com)",
        "accept-encoding": "identity",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `GH Archive fetch failed for ${targetHour}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 404: hour not yet published. Don't advance — retry next cycle.
  if (resp.status === 404) {
    clearTimeout(timer);
    logger.info(
      { sourceId: source.id, targetHour },
      "GH Archive: hour not yet published (404); retrying next cycle",
    );
    return { added: [] };
  }
  if (!resp.ok || !resp.body) {
    clearTimeout(timer);
    throw new Error(
      `GH Archive non-OK response for ${targetHour}: ${resp.status}`,
    );
  }

  // Cap layer 1: Content-Length pre-check. Skip oversize hours and
  // advance the cursor (otherwise the source pins forever on a bad file).
  const contentLengthHeader = resp.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > MAX_DOWNLOADED_BYTES
  ) {
    clearTimeout(timer);
    controller.abort();
    await updateSourceCursor(source.id, { lastFetchedHour: targetHour });
    logger.warn(
      { sourceId: source.id, targetHour, contentLength, cap: MAX_DOWNLOADED_BYTES },
      `GH Archive: hour=${targetHour} content-length ${contentLength} exceeds cap; skipping`,
    );
    return { added: [] };
  }

  const nodeStream = Readable.fromWeb(
    resp.body as unknown as NodeWebReadableStream<Uint8Array>,
  );
  const gunzip = createGunzip();
  nodeStream.on("error", (err) => gunzip.destroy(err));
  nodeStream.pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  let parsed = 0;
  let matched = 0;
  let downloaded = 0;
  let bytesCapHit = false;
  // Cap layer 2: enforce byte cap mid-stream when Content-Length is missing.
  // Aborting the controller errors the pipeline; we treat that as oversize.
  nodeStream.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded > MAX_DOWNLOADED_BYTES && !bytesCapHit) {
      bytesCapHit = true;
      controller.abort();
    }
  });

  const added: ObservationRow[] = [];
  try {
    for await (const line of rl) {
      if (parsed >= MAX_EVENTS_PARSED) break;
      if (added.length >= MAX_OBSERVATIONS_PER_CYCLE) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev: GhEvent;
      try {
        ev = JSON.parse(trimmed) as GhEvent;
      } catch {
        continue;
      }
      parsed += 1;
      if (!eventMatches(ev, filter)) continue;
      matched += 1;
      const obsInput = renderEvent(source, ev);
      if (!obsInput) continue;
      const obs = await insertObservationIfNew(obsInput);
      if (obs) added.push(obs);
    }
  } catch (err) {
    if (!bytesCapHit) throw err;
    logger.warn(
      { sourceId: source.id, targetHour, downloadedBytes: downloaded, cap: MAX_DOWNLOADED_BYTES },
      `GH Archive: hour=${targetHour} exceeded byte cap mid-stream (downloaded=${downloaded}); skipping`,
    );
  } finally {
    clearTimeout(timer);
    rl.close();
    nodeStream.unpipe();
    gunzip.destroy();
    nodeStream.destroy();
  }

  // Cursor advances on: clean read, cap-induced early exit, oversize hour.
  // Cursor stays put on: 404, network/decode error (handled via thrown errors above).
  await updateSourceCursor(source.id, { lastFetchedHour: targetHour });

  logger.info(
    {
      sourceId: source.id,
      hour: targetHour,
      parsed,
      matched,
      observations: added.length,
      downloadedBytes: downloaded,
    },
    `GH Archive: hour=${targetHour} parsed=${parsed} matched=${matched} obs=${added.length}`,
  );

  return { added };
}
