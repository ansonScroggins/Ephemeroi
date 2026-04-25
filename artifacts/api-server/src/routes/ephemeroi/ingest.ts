import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { logger } from "../../lib/logger";
import {
  insertObservationIfNew,
  markSourcePolled,
  type ObservationRow,
  type SourceRow,
} from "./store";
import { bus } from "./bus";
import { observationToWire } from "./wire";

const MAX_ITEMS_PER_SOURCE = 8;
const FETCH_TIMEOUT_MS = 12_000;

const rssParser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "user-agent":
      "Ephemeroi/0.1 (autonomous explorer; +https://replit.com)",
  },
});

export async function ingestSource(source: SourceRow): Promise<{
  added: ObservationRow[];
  error: string | null;
}> {
  try {
    let added: ObservationRow[] = [];
    if (source.kind === "rss") {
      added = await ingestRss(source);
    } else if (source.kind === "url") {
      added = await ingestUrl(source);
    } else if (source.kind === "search") {
      added = await ingestSearch(source);
    }
    await markSourcePolled(source.id, null);
    for (const obs of added) {
      bus.publish({ type: "observation", payload: observationToWire(obs) });
    }
    return { added, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { sourceId: source.id, kind: source.kind, err: msg },
      "Source ingestion failed",
    );
    await markSourcePolled(source.id, msg.slice(0, 500));
    return { added: [], error: msg };
  }
}

// ===== RSS =====

async function ingestRss(source: SourceRow): Promise<ObservationRow[]> {
  const feed = await rssParser.parseURL(source.target);
  const items = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SOURCE);
  const added: ObservationRow[] = [];
  for (const item of items) {
    const title = (item.title ?? "Untitled").trim();
    const link = (item.link ?? "").trim() || null;
    const snippet = cleanText(
      item.contentSnippet ??
        item.content ??
        item.summary ??
        item.title ??
        "",
    ).slice(0, 1200);
    const urlHash = link ? hashKey(link) : hashKey(`${source.id}:${title}`);
    const obs = await insertObservationIfNew({
      sourceId: source.id,
      sourceKind: source.kind,
      sourceLabel: source.label,
      title,
      snippet,
      url: link,
      urlHash,
    });
    if (obs) added.push(obs);
  }
  return added;
}

// ===== URL =====

async function ingestUrl(source: SourceRow): Promise<ObservationRow[]> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const resp = await fetch(source.target, {
      signal: ac.signal,
      headers: {
        "user-agent":
          "Ephemeroi/0.1 (autonomous explorer; +https://replit.com)",
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } finally {
    clearTimeout(t);
  }

  const title = extractTitle(html) ?? source.label;
  const snippet = extractMainText(html).slice(0, 1500);
  // For a URL source we re-poll the same target; the urlHash includes a
  // content fingerprint so a substantively changed page produces a new
  // observation, but a static page does not duplicate.
  const fingerprint = hashKey(`${source.target}::${snippet.slice(0, 600)}`);
  const obs = await insertObservationIfNew({
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title,
    snippet,
    url: source.target,
    urlHash: fingerprint,
  });
  return obs ? [obs] : [];
}

// ===== Search (stub) =====

async function ingestSearch(source: SourceRow): Promise<ObservationRow[]> {
  // Real web-search ingestion is deferred until a search API key is wired up.
  // For v1 we synthesise a single "topic prompt" observation per cycle so the
  // reflection loop has something to reason about for this topic, and so the
  // user sees their search topic show up in the live stream.
  const title = `Search topic: ${source.target}`;
  const snippet =
    `Ephemeroi is watching the topic "${source.target}". ` +
    `When a web-search provider is configured, fresh results for this query will appear here. ` +
    `For now, treat this as a recurring prompt to reflect on what is currently known about "${source.target}".`;
  const fingerprint = hashKey(`search:${source.id}:${dayBucket()}`);
  const obs = await insertObservationIfNew({
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title,
    snippet,
    url: null,
    urlHash: fingerprint,
  });
  return obs ? [obs] : [];
}

// ===== helpers =====

function dayBucket(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
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

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return cleanText(m[1] ?? "").slice(0, 240) || null;
}

function extractMainText(html: string): string {
  // Prefer the <main>/<article> body if present.
  const main = /<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i.exec(
    html,
  );
  const body = main
    ? main[1]!
    : (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html);
  return cleanText(body);
}
