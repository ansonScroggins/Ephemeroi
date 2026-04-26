import { z } from "zod/v4";
import { logger } from "../../lib/logger";
import type { SignalEnvelope } from "../../lib/signal-envelope";

// Curated catalog of free, keyless public APIs. The intent matcher picks the
// best entry by keyword score against the user's query, calls it, and
// validates the response with the entry's declared zod schema. Per-API budget
// is enforced via a rolling-minute counter — no runaway loops, no spam.

const CALL_TIMEOUT_MS = 7000;
const BUDGET_PER_MINUTE = 12;
const BUDGET_WINDOW_MS = 60_000;

interface BudgetSlot { count: number; windowStart: number }
const BUDGETS = new Map<string, BudgetSlot>();

function reserveBudget(id: string): boolean {
  const now = Date.now();
  const slot = BUDGETS.get(id);
  if (!slot || now - slot.windowStart >= BUDGET_WINDOW_MS) {
    BUDGETS.set(id, { count: 1, windowStart: now });
    return true;
  }
  if (slot.count >= BUDGET_PER_MINUTE) return false;
  slot.count += 1;
  return true;
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "Metacog/1.0 (exploration)" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// Strip leading question words so single-entity APIs (Wikipedia, REST
// Countries) get a clean noun phrase instead of "what is bitcoin".
function extractTopic(query: string): string {
  return query
    .trim()
    .replace(/^(what(?:'s| is)|who(?:'s| is)|tell me about|explain|describe|define)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

interface CallContext { query: string; topic: string }

interface CatalogEntry {
  id: string;
  description: string;
  intentKeywords: string[];
  baseScore: number;
  schema: z.ZodType<unknown>;
  call: (ctx: CallContext) => Promise<{ url: string; raw: unknown }>;
  summarize: (validated: unknown) => string;
  severity: (validated: unknown) => number;
}

// ───── Entry: Wikipedia summary ─────
const wikipediaSchema = z.object({
  title: z.string(),
  extract: z.string(),
  content_urls: z
    .object({ desktop: z.object({ page: z.string() }).partial().optional() })
    .partial()
    .optional(),
}).loose();

const wikipediaEntry: CatalogEntry = {
  id: "wikipedia-summary",
  description: "Plain-language summary of a topic from English Wikipedia.",
  intentKeywords: ["what", "who", "history", "definition", "biography", "wiki"],
  baseScore: 0.25,
  schema: wikipediaSchema,
  call: async ({ topic }) => {
    const slug = encodeURIComponent(topic.replace(/\s+/g, "_"));
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
    return { url, raw: await fetchJson(url) };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof wikipediaSchema>;
    return `${obj.title} — ${obj.extract}`;
  },
  severity: () => 0.5,
};

// ───── Entry: Open-Meteo current weather ─────
const geocodeSchema = z.object({
  results: z
    .array(z.object({ latitude: z.number(), longitude: z.number(), name: z.string(), country: z.string().optional() }))
    .optional(),
}).loose();

const meteoSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    wind_speed_10m: z.number().optional(),
    time: z.string().optional(),
  }),
}).loose();

const weatherEntry: CatalogEntry = {
  id: "open-meteo-weather",
  description: "Current temperature and wind for a city, via Open-Meteo.",
  intentKeywords: ["weather", "temperature", "forecast", "rain", "wind", "snow", "climate"],
  baseScore: 0,
  schema: meteoSchema,
  call: async ({ topic }) => {
    const place = topic
      .replace(/\b(weather|forecast|temperature|in|at|for|current|currently|today|now|the)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || topic;
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`;
    const geoRaw = await fetchJson(geoUrl);
    const geo = geocodeSchema.parse(geoRaw);
    const first = geo.results?.[0];
    if (!first) throw new Error(`No geocoding match for "${place}".`);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}` +
      `&longitude=${first.longitude}&current=temperature_2m,wind_speed_10m`;
    const raw = await fetchJson(url);
    return { url: `${url}#${first.name}`, raw };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof meteoSchema>;
    const wind = obj.current.wind_speed_10m;
    return `Currently ${obj.current.temperature_2m}°C` +
      (wind !== undefined ? `, wind ${wind} km/h` : "") +
      (obj.current.time ? ` (as of ${obj.current.time} UTC)` : "");
  },
  severity: () => 0.3,
};

// ───── Entry: REST Countries ─────
const countrySchema = z.array(
  z.object({
    name: z.object({ common: z.string(), official: z.string().optional() }).loose(),
    capital: z.array(z.string()).optional(),
    region: z.string().optional(),
    population: z.number().optional(),
    languages: z.record(z.string(), z.string()).optional(),
  }).loose(),
);

const countryEntry: CatalogEntry = {
  id: "rest-countries",
  description: "Capital, region, population, and languages of a country.",
  intentKeywords: [
    "country", "countries", "capital", "capitals",
    "population", "nation", "nations", "region",
  ],
  baseScore: 0,
  schema: countrySchema,
  call: async ({ topic, query }) => {
    // REST Countries `/name/{x}` matches partials but only on actual country
    // names. Strip topic stopwords, then try the cleaned topic; if that 404s,
    // fall back to each remaining word until one returns a 2xx body.
    const STOP = /\b(country|countries|capital|capitals|population|nation|nations|region|of|the|in|info|tell|me|about|what|is|are)\b/gi;
    const cleaned = topic.replace(STOP, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const candidates: string[] = [];
    if (cleaned) candidates.push(cleaned);
    for (const word of `${topic} ${query}`.replace(STOP, "").split(/[\s,]+/)) {
      const w = word.replace(/[^\w]/g, "").trim();
      if (w.length >= 3 && !candidates.includes(w)) candidates.push(w);
    }
    let lastErr: Error | null = null;
    for (const name of candidates) {
      const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,region,population,languages`;
      try {
        return { url, raw: await fetchJson(url) };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error("call failed");
      }
    }
    throw lastErr ?? new Error("No country candidate matched.");
  },
  summarize: (v) => {
    const list = v as z.infer<typeof countrySchema>;
    const c = list[0];
    if (!c) return "No matching country.";
    const langs = c.languages ? Object.values(c.languages).join(", ") : "n/a";
    const cap = c.capital?.[0] ?? "n/a";
    const pop = c.population !== undefined ? c.population.toLocaleString() : "n/a";
    return `${c.name.common} — capital ${cap}, ${c.region ?? "?"}, population ${pop}, languages: ${langs}.`;
  },
  severity: () => 0.4,
};

// ───── Entry: Open Library Search ─────
const openLibrarySchema = z.object({
  numFound: z.number().optional(),
  docs: z
    .array(
      z.object({
        title: z.string(),
        author_name: z.array(z.string()).optional(),
        first_publish_year: z.number().optional(),
        key: z.string().optional(),
      }).loose(),
    )
    .optional(),
}).loose();

const booksEntry: CatalogEntry = {
  id: "open-library",
  description: "Book search via Open Library — title, author, year.",
  intentKeywords: ["book", "books", "novel", "novels", "author", "authors", "isbn", "literature", "read"],
  baseScore: 0,
  schema: openLibrarySchema,
  call: async ({ topic }) => {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(topic)}&limit=3`;
    return { url, raw: await fetchJson(url) };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof openLibrarySchema>;
    const docs = obj.docs ?? [];
    if (docs.length === 0) return "No matching books found.";
    return docs
      .slice(0, 3)
      .map((d) => `"${d.title}"${d.author_name?.length ? ` by ${d.author_name[0]}` : ""}${d.first_publish_year ? ` (${d.first_publish_year})` : ""}`)
      .join("; ");
  },
  severity: (v) => {
    const obj = v as z.infer<typeof openLibrarySchema>;
    return (obj.docs?.length ?? 0) > 0 ? 0.4 : 0.1;
  },
};

// ───── Entry: USGS earthquakes (last day, M4.5+) ─────
const earthquakeSchema = z.object({
  features: z
    .array(
      z.object({
        properties: z
          .object({
            mag: z.number().nullable().optional(),
            place: z.string().nullable().optional(),
            time: z.number().optional(),
            url: z.string().optional(),
          })
          .loose(),
      }).loose(),
    )
    .optional(),
}).loose();

const earthquakeEntry: CatalogEntry = {
  id: "usgs-earthquakes",
  description: "Significant earthquakes in the last 24 hours from USGS.",
  intentKeywords: [
    "earthquake", "earthquakes", "seismic", "tremor", "tremors",
    "quake", "quakes", "tectonic", "richter",
  ],
  baseScore: 0,
  schema: earthquakeSchema,
  call: async () => {
    const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
    return { url, raw: await fetchJson(url) };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof earthquakeSchema>;
    const feats = obj.features ?? [];
    if (feats.length === 0) return "No M4.5+ earthquakes in the last 24 hours.";
    const top = feats
      .slice(0, 3)
      .map((f) => `M${f.properties.mag?.toFixed(1) ?? "?"} ${f.properties.place ?? "unknown"}`)
      .join("; ");
    return `${feats.length} earthquake(s) in the last 24h. Notable: ${top}.`;
  },
  severity: (v) => {
    const obj = v as z.infer<typeof earthquakeSchema>;
    const max = (obj.features ?? []).reduce((m, f) => Math.max(m, f.properties.mag ?? 0), 0);
    if (max >= 7) return 0.85;
    if (max >= 6) return 0.65;
    if (max >= 5) return 0.45;
    return 0.2;
  },
};

// ───── Entry: CoinGecko crypto price ─────
const COIN_MAP: Record<string, string> = {
  bitcoin: "bitcoin", btc: "bitcoin",
  ethereum: "ethereum", eth: "ethereum",
  solana: "solana", sol: "solana",
  cardano: "cardano", ada: "cardano",
  dogecoin: "dogecoin", doge: "dogecoin",
  litecoin: "litecoin", ltc: "litecoin",
  ripple: "ripple", xrp: "ripple",
  monero: "monero", xmr: "monero",
};

const coinSchema = z.record(z.string(), z.object({ usd: z.number() }).loose());

const cryptoEntry: CatalogEntry = {
  id: "coingecko-price",
  description: "Live USD price for a major cryptocurrency.",
  intentKeywords: [
    "price", "prices", "bitcoin", "btc", "ethereum", "eth", "crypto", "solana",
    "doge", "dogecoin", "cardano", "ada", "monero", "xmr", "litecoin", "ltc",
    "ripple", "xrp", "coin", "coins",
  ],
  baseScore: 0,
  schema: coinSchema,
  call: async ({ topic, query }) => {
    const haystack = `${topic} ${query}`.toLowerCase();
    let coinId: string | null = null;
    for (const [name, id] of Object.entries(COIN_MAP)) {
      if (new RegExp(`\\b${name}\\b`).test(haystack)) { coinId = id; break; }
    }
    if (!coinId) throw new Error("No supported coin name detected in query.");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    return { url, raw: await fetchJson(url) };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof coinSchema>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return "No price returned.";
    const [name, data] = entries[0]!;
    return `${name} — $${data.usd.toLocaleString()} USD.`;
  },
  severity: () => 0.35,
};

// ───── Entry: ISS current position ─────
const issSchema = z.object({
  iss_position: z.object({ latitude: z.string(), longitude: z.string() }),
  timestamp: z.number().optional(),
}).loose();

const issEntry: CatalogEntry = {
  id: "iss-position",
  description: "Live latitude/longitude of the International Space Station.",
  intentKeywords: ["iss", "space station", "international space station", "orbit"],
  baseScore: 0,
  schema: issSchema,
  call: async () => {
    const url = "http://api.open-notify.org/iss-now.json";
    return { url, raw: await fetchJson(url) };
  },
  summarize: (v) => {
    const obj = v as z.infer<typeof issSchema>;
    return `ISS at lat ${obj.iss_position.latitude}, lon ${obj.iss_position.longitude}.`;
  },
  severity: () => 0.25,
};

const CATALOG: CatalogEntry[] = [
  wikipediaEntry,
  weatherEntry,
  countryEntry,
  booksEntry,
  earthquakeEntry,
  cryptoEntry,
  issEntry,
];

interface PickResult { entry: CatalogEntry; score: number }

function pickEntry(query: string): PickResult | null {
  const haystack = query.toLowerCase();
  let best: PickResult | null = null;
  for (const entry of CATALOG) {
    let hits = 0;
    for (const kw of entry.intentKeywords) {
      if (new RegExp(`\\b${kw.toLowerCase().replace(/\s+/g, "\\s+")}\\b`).test(haystack)) hits += 1;
    }
    // Raw hit count + small base. We deliberately don't normalise by
    // intentKeywords.length — a single strong keyword match (e.g. "weather"
    // → weatherEntry) must beat Wikipedia's baseline default. Wikipedia
    // wins ties only when nothing else matched at all.
    const score = entry.baseScore + hits;
    if (!best || score > best.score) best = { entry, score };
  }
  if (!best || best.score === 0) return null;
  return best;
}

export interface ExplorationResult {
  picked: { id: string; description: string; url: string; match: number } | null;
  summary: string;
  raw: Record<string, unknown> | null;
  signal: SignalEnvelope | null;
  degraded: boolean;
  notes: string;
}

export async function exploreWithCatalog(query: string): Promise<ExplorationResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { picked: null, summary: "", raw: null, signal: null, degraded: true, notes: "Empty query." };
  }

  const pick = pickEntry(trimmed);
  if (!pick) {
    return {
      picked: null, summary: "", raw: null, signal: null, degraded: true,
      notes: "No catalog entry matched this query.",
    };
  }

  const { entry, score } = pick;
  if (!reserveBudget(entry.id)) {
    return {
      picked: { id: entry.id, description: entry.description, url: "", match: score },
      summary: "",
      raw: null,
      signal: null,
      degraded: true,
      notes: `Per-API budget exhausted for "${entry.id}" (max ${BUDGET_PER_MINUTE}/min).`,
    };
  }

  let url = "";
  let raw: unknown;
  try {
    const out = await entry.call({ query: trimmed, topic: extractTopic(trimmed) });
    url = out.url;
    raw = out.raw;
  } catch (err) {
    const message = err instanceof Error ? err.message : "call failed";
    logger.warn({ apiId: entry.id, err: message }, "exploration call failed");
    return {
      picked: { id: entry.id, description: entry.description, url: "", match: score },
      summary: "", raw: null, signal: null, degraded: true,
      notes: `${entry.id} unreachable (${message}).`,
    };
  }

  const parsed = entry.schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { apiId: entry.id, issues: parsed.error.issues.slice(0, 3) },
      "exploration response failed schema validation",
    );
    return {
      picked: { id: entry.id, description: entry.description, url, match: score },
      summary: "", raw: null, signal: null, degraded: true,
      notes: `${entry.id} returned a payload that failed schema validation.`,
    };
  }

  const summary = entry.summarize(parsed.data);
  const severity = entry.severity(parsed.data);
  const signal: SignalEnvelope = {
    origin: "metacog",
    role: "exploration",
    severity,
    headline: `Exploration via ${entry.id}: ${summary.slice(0, 120)}`,
    body: `Query: "${trimmed}"\nAPI: ${entry.id} — ${entry.description}\nResult: ${summary}\nSource: ${url}`,
    subject: trimmed,
    evidence: { apiId: entry.id, url, summary },
  };

  const rawObj: Record<string, unknown> | null =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : { value: raw };

  return {
    picked: { id: entry.id, description: entry.description, url, match: score },
    summary, raw: rawObj, signal, degraded: false,
    notes: `Picked ${entry.id} (score ${score.toFixed(2)}).`,
  };
}
