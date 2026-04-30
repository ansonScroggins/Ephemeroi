/**
 * Streaming ingestion pipeline: ingest → interpret → emit → (repeat).
 *
 * Provides two things:
 *
 *  1. `streamSource(url, onChunk)` — raw streaming primitive: fetch a URL and
 *     call `onChunk` for every text chunk as it arrives. Implemented with
 *     native Node 24 fetch + Readable.fromWeb — same pattern as
 *     `ingest-gharchive.ts`, zero extra deps. The signature matches:
 *
 *       import got from "got";
 *       const stream = got.stream(url);
 *       for await (const chunk of stream) { await onChunk(chunk.toString()); }
 *
 *  2. `runStreamIngest(source, opts)` — the full pipeline for a "stream"
 *     source kind: ingest chunks → buffer into logical units (newline-delimited
 *     NDJSON lines or 500-char text paragraphs) → interpret each unit →
 *     insertObservationIfNew → emit to SSE bus immediately.
 *
 * Why streaming vs batch?
 *  - NDJSON firehoses: the first observation lands in DB and on the SSE bus
 *    as soon as the first line arrives — not after the full response completes.
 *  - Very large sources: no OOM from buffering gigabytes before processing.
 *  - Text streams: each logical unit is independently hashed so deduplication
 *    still works chunk-by-chunk.
 *
 * The "repeat" is handled by the existing cycle loop: the loop calls
 * ingestSource() → runStreamIngest() on each cycle, just like every other
 * source kind. No special scheduler needed.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { logger } from "../../lib/logger";
import { assertPublicHttpUrl } from "./guard";
import { insertObservationIfNew, type ObservationRow, type SourceRow } from "./store";
import { bus } from "./bus";
import { observationToWire } from "./wire";

// ===== Limits =====

const MAX_BYTES = 8 * 1024 * 1024;    // 8 MB per stream pass
const MAX_UNITS = 100;                  // max logical units interpreted
const MAX_OBS_PER_PASS = 20;           // max new observations inserted
const UNIT_MIN_CHARS = 80;             // ignore noise below this
const STREAM_TIMEOUT_MS = 60_000;      // 60 s wall-clock timeout per pass

// ===== Public API =====

export interface StreamIngestResult {
  added: ObservationRow[];
  bytesRead: number;
  unitsInterpreted: number;
  errors: string[];
}

/**
 * Raw streaming primitive — mirrors `got.stream(url)` with native fetch.
 *
 * ```ts
 * await streamSource(url, async (chunk) => {
 *   // chunk is a raw text string as it arrives
 * });
 * ```
 *
 * Streams until EOF, timeout, byte cap, or abort signal. Calls `onChunk`
 * synchronously within the stream loop — back-pressure is implicit because
 * we `await onChunk(text)` before reading the next chunk.
 */
export async function streamSource(
  url: string,
  onChunk: (chunk: string) => Promise<void>,
  opts: {
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<{ bytesRead: number }> {
  const { maxBytes = MAX_BYTES, timeoutMs = STREAM_TIMEOUT_MS, signal, headers = {} } = opts;

  // Combine caller's abort signal with an internal timeout signal.
  const timer = AbortSignal.timeout(timeoutMs);
  const combined = signal
    ? AbortSignal.any([signal, timer])
    : timer;

  const validUrl = await assertPublicHttpUrl(url);
  const resp = await fetch(validUrl.href, {
    signal: combined,
    headers: {
      "user-agent": "Ephemeroi/0.1 (stream-ingest; +https://replit.com)",
      accept: "application/x-ndjson, text/event-stream, text/plain, */*",
      ...headers,
    },
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
  }
  if (!resp.body) {
    throw new Error(`Response body is null for ${url}`);
  }

  const nodeStream = Readable.fromWeb(
    resp.body as unknown as NodeWebReadableStream<Uint8Array>,
  );

  let bytesRead = 0;
  for await (const rawChunk of nodeStream) {
    const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    bytesRead += buf.byteLength;
    if (bytesRead > maxBytes) {
      nodeStream.destroy();
      logger.debug({ url, bytesRead }, "stream-ingest: byte cap reached");
      break;
    }
    await onChunk(buf.toString("utf8"));
  }
  return { bytesRead };
}

// ===== Full pipeline =====

/**
 * ingest → interpret → emit pipeline for one pass over a streaming source.
 *
 * Chunks are buffered into logical units by `LineBuffer` (NDJSON) or
 * `ParagraphBuffer` (plain text/HTML), then interpreted and inserted into
 * the observations table immediately — each emit fires on the SSE bus
 * before the next chunk is even read.
 */
export async function runStreamIngest(
  source: SourceRow,
  opts: { signal?: AbortSignal } = {},
): Promise<StreamIngestResult> {
  const added: ObservationRow[] = [];
  const errors: string[] = [];
  let unitsInterpreted = 0;
  let bytesRead = 0;

  // Detect format from the URL + source config.
  // Explicit format in source target takes priority; else sniff.
  let format: "ndjson" | "text" = detectFormat(source.target);

  const buffer = format === "ndjson" ? new LineBuffer() : new ParagraphBuffer();

  try {
    const result = await streamSource(
      source.target,
      async (chunk) => {
        if (added.length >= MAX_OBS_PER_PASS) return;
        const units = buffer.push(chunk);
        for (const unit of units) {
          if (unitsInterpreted >= MAX_UNITS) break;
          unitsInterpreted++;
          const interpreted = interpretUnit(unit, format);
          if (!interpreted) continue;
          try {
            const obs = await insertObservationIfNew({
              sourceId: source.id,
              sourceKind: source.kind,
              sourceLabel: source.label,
              title: interpreted.title,
              snippet: interpreted.snippet,
              url: interpreted.url,
              urlHash: interpreted.urlHash,
            });
            if (obs) {
              added.push(obs);
              // emit immediately — this is the "→ emit" step
              bus.publish({ type: "observation", payload: observationToWire(obs) });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(msg);
          }
        }
      },
      { maxBytes: MAX_BYTES, signal: opts.signal },
    );
    bytesRead = result.bytesRead;

    // Drain any partial unit left in the buffer at EOF.
    const tail = buffer.flush();
    for (const unit of tail) {
      if (unitsInterpreted >= MAX_UNITS || added.length >= MAX_OBS_PER_PASS) break;
      unitsInterpreted++;
      const interpreted = interpretUnit(unit, format);
      if (!interpreted) continue;
      const obs = await insertObservationIfNew({
        sourceId: source.id,
        sourceKind: source.kind,
        sourceLabel: source.label,
        title: interpreted.title,
        snippet: interpreted.snippet,
        url: interpreted.url,
        urlHash: interpreted.urlHash,
      });
      if (obs) {
        added.push(obs);
        bus.publish({ type: "observation", payload: observationToWire(obs) });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    logger.warn({ sourceId: source.id, err: msg }, "stream-ingest: stream error");
  }

  logger.info(
    { sourceId: source.id, added: added.length, bytesRead, unitsInterpreted, errors: errors.length },
    "stream-ingest: pass complete",
  );
  return { added, bytesRead, unitsInterpreted, errors };
}

// ===== Interpret =====

interface InterpretedUnit {
  title: string;
  snippet: string;
  url: string | null;
  urlHash: string;
}

function interpretUnit(
  unit: string,
  format: "ndjson" | "text",
): InterpretedUnit | null {
  if (unit.trim().length < UNIT_MIN_CHARS) return null;
  if (format === "ndjson") return interpretNdjson(unit);
  return interpretText(unit);
}

function interpretNdjson(line: string): InterpretedUnit | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    // Not valid JSON — treat as plain text
    return interpretText(line);
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  // Heuristic field extraction: try common event-stream schemas.
  const url = strField(o, "url", "html_url", "link", "href") ?? null;
  const title =
    strField(o, "title", "name", "summary", "headline", "message") ??
    strField(o, "type") ??
    "Stream event";
  const bodyFields = strField(
    o,
    "body",
    "description",
    "content",
    "text",
    "snippet",
  );
  // For GitHub-style events: actor.login + repo.name + type
  const actor = nested(o, "actor", "login") ?? nested(o, "sender", "login");
  const repo = nested(o, "repo", "name") ?? nested(o, "repository", "full_name");
  const eventType = strField(o, "type", "event", "action");

  const titleFull = [
    eventType && actor ? `${actor}: ${eventType}` : null,
    repo ? `on ${repo}` : null,
    title !== "Stream event" ? title : null,
  ]
    .filter(Boolean)
    .join(" ") || "Stream event";

  const snippet = [bodyFields, repo, actor, eventType]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1500) || JSON.stringify(obj).slice(0, 1500);

  const urlHash = hashKey(url ? url : `ndjson:${line.slice(0, 300)}`);
  return { title: titleFull.slice(0, 240), snippet, url, urlHash };
}

function interpretText(chunk: string): InterpretedUnit | null {
  const clean = cleanText(chunk);
  if (clean.length < UNIT_MIN_CHARS) return null;
  // First sentence or first 80 chars as title.
  const dotIdx = clean.search(/[.!?]\s/);
  const title = (dotIdx > 0 ? clean.slice(0, dotIdx + 1) : clean.slice(0, 80)).trim();
  const snippet = clean.slice(0, 1500);
  const urlHash = hashKey(`text:${snippet.slice(0, 400)}`);
  return { title: title.slice(0, 240), snippet, url: null, urlHash };
}

// ===== Buffers =====

/**
 * NDJSON buffer: accumulates raw bytes and emits one entry per complete line.
 */
class LineBuffer {
  private buf = "";
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    return lines.filter((l) => l.trim().length > 0);
  }
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest.length > 0 ? [rest] : [];
  }
}

/**
 * Paragraph buffer: splits on double newlines or accumulates until
 * it has at least PARAGRAPH_SIZE chars to emit.
 */
const PARAGRAPH_SIZE = 500;
class ParagraphBuffer {
  private buf = "";
  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split(/\n\n+/);
    this.buf = parts.pop() ?? "";
    // Also flush anything that's grown very large within a paragraph.
    const oversized: string[] = [];
    while (this.buf.length > PARAGRAPH_SIZE * 3) {
      const idx = this.buf.lastIndexOf("\n", PARAGRAPH_SIZE * 2);
      const cut = idx > 0 ? idx : PARAGRAPH_SIZE * 2;
      oversized.push(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
    }
    return [...parts, ...oversized];
  }
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest.length > 0 ? [rest] : [];
  }
}

// ===== Helpers =====

function detectFormat(url: string): "ndjson" | "text" {
  const u = url.toLowerCase();
  if (
    u.includes("ndjson") ||
    u.includes(".jsonl") ||
    u.includes(".ndjson") ||
    u.includes("gharchive") ||
    u.includes("stream") && u.includes("json")
  ) {
    return "ndjson";
  }
  return "text";
}

function strField(
  o: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function nested(
  o: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  let cur: unknown = o;
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : undefined;
}

function hashKey(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function cleanText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
