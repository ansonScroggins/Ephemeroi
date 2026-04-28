import { logger } from "../../lib/logger";
import type { SignalEnvelope } from "../../lib/signal-envelope";

// Harvard Dataverse public search. No key required.
// Docs: https://guides.dataverse.org/en/latest/api/search.html
const DATAVERSE_URL = "https://dataverse.harvard.edu/api/search";
const TIMEOUT_MS = 8000;
const PER_PAGE = 5;

export interface DataverseHit {
  title: string;
  citation: string;
  url: string;
  abstract: string;
}

export interface DataverseResult {
  hits: DataverseHit[];
  degraded: boolean;
  notes: string;
  signal: SignalEnvelope | null;
}

// Narrowing helpers — keep us honest about external JSON without leaking `any`.
function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function searchDataverse(query: string): Promise<DataverseResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { hits: [], degraded: true, notes: "Empty query.", signal: null };
  }

  const url = `${DATAVERSE_URL}?q=${encodeURIComponent(trimmed)}&type=dataset&per_page=${PER_PAGE}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "Metacog/1.0 (truth-anchor)" },
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, url }, "Dataverse non-2xx");
      return { hits: [], degraded: true, notes: `Dataverse returned ${resp.status}.`, signal: null };
    }
    raw = await resp.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    logger.warn({ err: message, url }, "Dataverse fetch failed");
    return { hits: [], degraded: true, notes: `Dataverse unreachable (${message}).`, signal: null };
  } finally {
    clearTimeout(timer);
  }

  const root = asObj(raw);
  const data = asObj(root?.["data"]);
  const items = asArr(data?.["items"]);

  const hits: DataverseHit[] = [];
  for (const item of items) {
    const obj = asObj(item);
    if (!obj) continue;
    const title = asStr(obj["name"]);
    const url = asStr(obj["url"]);
    if (!title || !url) continue;
    hits.push({
      title,
      citation: asStr(obj["citation"]),
      url,
      abstract: asStr(obj["description"]).slice(0, 600),
    });
  }

  if (hits.length === 0) {
    return {
      hits: [],
      degraded: false,
      notes: "Dataverse returned no matching datasets for this query.",
      signal: null,
    };
  }

  // Severity scales with hit count — more independent citations = stronger
  // anchor. Cap at 0.85 since a Dataverse hit is supporting, not definitive.
  const severity = Math.min(0.85, 0.4 + 0.1 * hits.length);
  const headline = `Truth anchor: ${hits.length} Dataverse dataset(s) for "${trimmed}"`;
  const body = hits
    .slice(0, 3)
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.citation}\n   ${h.url}`)
    .join("\n");

  const signal: SignalEnvelope = {
    origin: "metacog",
    role: "truth-anchor",
    severity,
    headline,
    body,
    subject: trimmed,
    evidence: { hits: hits.slice(0, 3) },
  };

  return { hits, degraded: false, notes: `Found ${hits.length} dataset(s).`, signal };
}
