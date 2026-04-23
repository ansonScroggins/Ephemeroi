import type { SearchMode, ReasoningLens, StreamEvent } from "@/hooks/use-search-stream";

const STORAGE_KEY = "metacog:memory:v1";
const MAX_ENTRIES = 50;
const SIMILARITY_THRESHOLD = 0.32;

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","must","can","of","in","on","at","to","for","with",
  "by","from","up","about","into","through","during","before","after","above","below","between",
  "out","off","over","under","again","further","then","once","and","but","or","nor","so","yet",
  "i","you","he","she","it","we","they","what","which","who","whom","this","that","these","those",
  "am","my","your","his","her","its","our","their","whats","wheres","hows","whys","please","tell",
  "me","explain","describe","help","ok","okay","just","really","actually","kind","sort",
]);

export interface MemoryEntry {
  id: string;
  query: string;
  mode: SearchMode;
  timestamp: number;
  summary: string;
  confidence: number | null;
  lensesUsed: ReasoningLens[];
  tokens: string[];
}

function normalizeTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    )
  );
}

function fingerprint(mode: SearchMode, tokens: string[]): string {
  const sorted = [...tokens].sort().join("|");
  let h = 5381;
  const seed = `${mode}::${sorted}`;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
  }
  return `m_${(h >>> 0).toString(36)}`;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let intersection = 0;
  for (const t of a) if (setB.has(t)) intersection++;
  const union = a.length + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

function readAll(): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string");
  } catch {
    return [];
  }
}

function writeAll(entries: MemoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or disabled — silently noop
  }
}

export interface MemoryMatch {
  entry: MemoryEntry;
  similarity: number;
}

export function findSimilar(query: string, mode: SearchMode): MemoryMatch | null {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) return null;

  const entries = readAll();
  let best: MemoryMatch | null = null;

  for (const entry of entries) {
    if (entry.mode !== mode) continue;
    const sim = jaccard(tokens, entry.tokens);
    if (sim >= SIMILARITY_THRESHOLD && (!best || sim > best.similarity)) {
      best = { entry, similarity: sim };
    }
  }
  return best;
}

export interface SaveRunInput {
  query: string;
  mode: SearchMode;
  events: StreamEvent[];
}

export function saveRun({ query, mode, events }: SaveRunInput): MemoryEntry | null {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) return null;

  let summary = "";
  let confidence: number | null = null;
  const lensSet = new Set<ReasoningLens>();

  for (const ev of events) {
    if (ev.type !== "step") continue;
    if (ev.stepType === "REFLECT" && ev.data.personalSummary) {
      summary = ev.data.personalSummary;
    }
    if (ev.stepType === "SYNTHESIZE" && typeof ev.data.finalConfidence === "number") {
      confidence = ev.data.finalConfidence;
    }
    if (ev.stepType === "RETRIEVE" && ev.data.lens) {
      lensSet.add(ev.data.lens);
    }
  }

  if (!summary) return null;

  const entry: MemoryEntry = {
    id: fingerprint(mode, tokens),
    query,
    mode,
    timestamp: Date.now(),
    summary,
    confidence,
    lensesUsed: Array.from(lensSet),
    tokens,
  };

  const existing = readAll().filter((e) => e.id !== entry.id);
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
  writeAll(updated);
  return entry;
}

export function clearMemory(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function listMemory(): MemoryEntry[] {
  return readAll();
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}
