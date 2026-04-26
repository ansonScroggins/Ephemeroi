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

/**
 * GH Archive ingestor — https://www.gharchive.org/
 *
 * Each hour the project publishes the entire public GitHub event firehose
 * for that hour as a gzipped, newline-delimited JSON file at
 *   https://data.gharchive.org/YYYY-MM-DD-H.json.gz
 * (note: hour is *not* zero-padded — "3" not "03").
 *
 * One uncompressed dump is ~1GB and contains hundreds of thousands of
 * events, so we MUST stream-decode it (never JSON.parse the whole file)
 * and we MUST narrow it via a filter expression. The filter is stored in
 * `source.target` as a comma-separated mini-DSL of `key:value` pairs:
 *
 *   repo:facebook/                   — repo full_name starts with prefix
 *   repo:torvalds/linux              — exact repo full_name (still a prefix)
 *   event:PullRequestEvent           — exact event type match
 *   org:nodejs                       — owner / org login match
 *
 * Multiple filters are AND-combined. Empty target = match everything (only
 * useful with very small backfills since the per-cycle observation cap
 * still bites). Source dedup uses (kind, target), so two distinct filter
 * expressions are two distinct sources.
 *
 * Cursor stores `{ lastFetchedHour: "YYYY-MM-DD-H" }`. Each cycle we fetch
 * exactly ONE hour — either `nextHour(lastFetchedHour)` or, on first run,
 * the most recent fully-published hour (see PUBLISH_LAG_HOURS). A 404 means
 * the hour isn't published yet; we don't advance the cursor and retry next
 * cycle. Network errors throw and propagate to the dispatcher's
 * `markSourcePolled(err)` path; cursor stays put.
 */

// ---- caps ----
// Hard ceiling on a single hour's compressed size. Real hours are
// 30-100MB. Anything larger almost certainly means the URL is wrong /
// gharchive is misbehaving — we skip the hour (and advance the cursor)
// rather than risk OOM or pin the cycle on a bad file forever.
//
// Enforcement is two-layered:
//   1. Content-Length pre-check before we start the stream. Cheap, avoids
//      pulling any bytes off the socket.
//   2. Mid-stream byte counter that calls `controller.abort()` if the
//      header was missing/wrong. The aborted fetch errors out the stream
//      pipeline, we catch the AbortError, and we treat it as "oversize
//      hour" — same outcome as path 1.
//
// Note: we deliberately do NOT push(null) into a mid-gzip member to stop
// reading; that produces a Z_BUF_ERROR which would propagate as a real
// failure and (per our cursor policy below) stall the source.
const MAX_DOWNLOADED_BYTES = 120 * 1024 * 1024;
// Upper bound on `JSON.parse` calls per cycle so a malformed / pathological
// dump can't burn the loop. Real hours are ~150-300K events. This is also
// the implicit memory ceiling when Content-Length is absent (300K events ×
// ~500 bytes/event ≈ 150MB raw, safely below process limits).
const MAX_EVENTS_PARSED = 300_000;
// After filtering, hard cap on how many observations we hand to the
// reflection pipeline per cycle. The rest is intentionally dropped.
const MAX_OBSERVATIONS_PER_CYCLE = 25;
// GH Archive publishes ~1-2 hours behind real time. On first poll we start
// at (now - PUBLISH_LAG_HOURS) so we don't immediately 404.
const PUBLISH_LAG_HOURS = 2;
// Hard wall-clock timeout on the whole fetch+stream — long enough for an
// 80MB gzip on a slow link, short enough not to wedge the cycle.
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

interface ParsedFilter {
  repos: string[]; // lower-case prefixes of "owner/repo"
  events: string[]; // exact event type names
  orgs: string[]; // lower-case org / owner logins
}

// ---- narrowing helpers (avoid `any` for the heterogeneous payload shape) ----
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
    if (!r) return false;
    if (!f.repos.some((p) => r.startsWith(p))) return false;
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

/**
 * Render one event as an Observation. Title and snippet are tailored per
 * event type so reflections have something descriptive to chew on rather
 * than the raw JSON. URL prefers the canonical github.com link for the
 * underlying object; falls back to the repo URL.
 */
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

  // urlHash uniqueness key. Scope by sourceId so two distinct gh_archive
  // sources with overlapping filters each ingest the same event into their
  // own reflection chain (otherwise the second one would be silently
  // dropped by the (urlHash) UNIQUE constraint). Within a single source we
  // dedup by the firehose's own event id (globally unique) when present,
  // falling back to a content key for the rare missing-id case.
  const evKey = ev.id
    ? ev.id
    : `${repo}:${type}:${ev.created_at ?? ""}:${actor}`;
  const dedupKey = `gha:${source.id}:${evKey}`;
  const urlHash = createHash("sha256").update(dedupKey).digest("hex");

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

  // Don't try to fetch hours that physically can't exist yet (avoids a
  // guaranteed 404 + log noise).
  const earliest = new Date();
  earliest.setUTCHours(earliest.getUTCHours() - 1);
  if (parseHourKey(targetHour) > earliest) {
    logger.debug(
      {
        sourceId: source.id,
        targetHour,
        lastFetched: cursor.lastFetchedHour ?? null,
      },
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
        "accept-encoding": "identity", // we want raw .gz, not double-encoded
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(
      `GH Archive fetch failed for ${targetHour}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 404 = the hour isn't published yet (or never will be — gharchive has
  // historical gaps). Don't advance the cursor; we'll retry next cycle.
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

  // Pre-flight size check via Content-Length. We refuse to start
  // streaming a gzip larger than MAX_DOWNLOADED_BYTES because (a) it's
  // almost certainly malformed and (b) truncating mid-gzip produces a
  // Z_BUF_ERROR that would throw out of the for-await loop and prevent
  // the cursor from advancing — stalling the source forever on the same
  // bad hour. Skipping the hour AND advancing the cursor breaks the
  // stall. If Content-Length is absent (rare for gharchive), we proceed
  // and rely on MAX_EVENTS_PARSED as the implicit memory ceiling.
  const contentLengthHeader = resp.headers.get("content-length");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : null;
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_DOWNLOADED_BYTES) {
    clearTimeout(timer);
    try {
      // Cancel the in-flight body so the socket closes promptly.
      controller.abort();
    } catch {
      // best-effort
    }
    await updateSourceCursor(source.id, { lastFetchedHour: targetHour });
    logger.warn(
      {
        sourceId: source.id,
        targetHour,
        contentLength,
        cap: MAX_DOWNLOADED_BYTES,
      },
      `GH Archive: hour=${targetHour} content-length ${contentLength} exceeds cap ${MAX_DOWNLOADED_BYTES}; skipping (cursor advanced)`,
    );
    return { added: [] };
  }

  // Pipeline: web ReadableStream → Node Readable → gunzip → readline.
  // The node:stream/web ReadableStream type is structurally identical to
  // the global one but TypeScript treats them as distinct, so cast through
  // the typed shape rather than `any`.
  const nodeStream = Readable.fromWeb(
    resp.body as unknown as NodeWebReadableStream<Uint8Array>,
  );
  const gunzip = createGunzip();
  // Forward fetch-side errors onto the readline input stream so the
  // for-await loop rejects rather than silently hanging.
  nodeStream.on("error", (err) => gunzip.destroy(err));
  nodeStream.pipe(gunzip);

  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  let parsed = 0;
  let matched = 0;
  let downloaded = 0;
  let bytesCapHit = false;
  // Defense-in-depth: enforce MAX_DOWNLOADED_BYTES even when Content-Length
  // is absent or wrong. AbortController.abort() closes the socket, which
  // errors the stream pipeline; we catch the AbortError below and treat it
  // identically to a Content-Length oversize hit (advance cursor, skip).
  nodeStream.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded > MAX_DOWNLOADED_BYTES && !bytesCapHit) {
      bytesCapHit = true;
      try {
        controller.abort();
      } catch {
        // best-effort
      }
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
        continue; // skip malformed lines, keep going
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
    if (!bytesCapHit) {
      // Real I/O / decode error — let the dispatcher record it via
      // `markSourcePolled(err)`. Cursor stays put so we retry next cycle.
      throw err;
    }
    // bytesCapHit: oversize hour discovered mid-stream. Treat the same
    // as a Content-Length pre-check failure: log + advance cursor (so we
    // don't pin every cycle on the same bad file). Whatever observations
    // we did manage to persist before the abort still count.
    logger.warn(
      {
        sourceId: source.id,
        targetHour,
        downloadedBytes: downloaded,
        cap: MAX_DOWNLOADED_BYTES,
      },
      `GH Archive: hour=${targetHour} exceeded byte cap mid-stream (downloaded=${downloaded}); skipping (cursor advanced)`,
    );
  } finally {
    clearTimeout(timer);
    rl.close();
    // Detach the in-flight stream chain so the underlying socket closes
    // promptly when we early-exit (event/observation cap, abort, or error).
    try {
      nodeStream.unpipe();
      gunzip.destroy();
      nodeStream.destroy();
    } catch {
      // best-effort cleanup
    }
  }

  // Cursor policy (codified):
  //   * 404 (hour not yet published)            → don't advance, retry
  //   * Network / fetch error                   → don't advance, retry
  //   * Decode / readline error mid-stream      → don't advance, retry
  //   * Oversize hour (Content-Length OR mid-stream byte cap)
  //                                             → advance, skip permanently
  //   * Cap-induced early exit (events / obs)   → advance, normal completion
  //   * Clean read to EOF                       → advance, normal completion
  // Only successful (or successfully-skipped-as-oversize) reads land here.
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
