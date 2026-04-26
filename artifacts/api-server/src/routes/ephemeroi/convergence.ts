import {
  signalBus,
  type SignalEnvelope,
} from "../../lib/signal-envelope";
import { logger } from "../../lib/logger";
import { sendTelegramText, isTelegramConfigured } from "./telegram";

// ============================================================================
// Unified Telegram convergence subscriber
// ----------------------------------------------------------------------------
// Single subscriber on `signalBus` that fans every cross-site envelope out
// to Telegram with an `[Origin · role]` badge.
//
// Convergence rule
// ----------------
// - Every envelope is buffered for `MERGE_DELAY_MS` (default 3s) under a
//   per-(origin, normalized-subject) key. While buffered, an arriving envelope
//   from the OTHER limb whose subject overlaps cancels the pending send and
//   emits a single MERGED `[Cross-limb · ephemeroi+metacog]` message instead.
// - After delivery, the envelope is also stashed in a `RECENT_WINDOW_MS`
//   (default 5min) recent-sends window. A later envelope from the OTHER limb
//   on an overlapping subject goes out as a `[Cross-limb correlation · …]`
//   follow-up rather than a stand-alone single-limb message — so the user
//   sees that the two sites converged on the same subject.
//
// Subject overlap is intentionally simple (≥1 significant token of length≥4
// shared between normalized subjects). This is conservative enough to avoid
// false correlations in v1; the rule lives in one place and is easy to tune.
//
// Telegram failures are logged but never propagate — the formatted message is
// always written to the structured log first, so the audit trail survives a
// missing/unreachable Telegram bot.
// ============================================================================

const MERGE_DELAY_MS = Number(
  process.env["EPHEMEROI_CONVERGENCE_MERGE_MS"] ?? 3_000,
);
const RECENT_WINDOW_MS = Number(
  process.env["EPHEMEROI_CONVERGENCE_WINDOW_MS"] ?? 5 * 60 * 1000,
);
const MAX_RECENT_ENTRIES = 256;

// Tokens that are too generic to anchor a cross-limb correlation. Add to this
// list when false correlations show up in practice.
const STOP_TOKENS = new Set([
  "github", "metacog", "ephemeroi", "https", "http",
  "with", "from", "this", "that", "what", "when", "where", "which",
  "have", "been", "into", "about", "their", "there", "them",
  "would", "could", "should", "very", "more", "most",
]);

interface PendingEntry {
  envelope: SignalEnvelope;
  tokens: Set<string>;
  arrivedAt: number;
  timer: NodeJS.Timeout;
}

interface RecentEntry {
  envelope: SignalEnvelope;
  tokens: Set<string>;
  sentAt: number;
}

const pending: Map<string, PendingEntry> = new Map();
const recent: RecentEntry[] = [];

function tokenize(s: string | undefined): Set<string> {
  if (!s) return new Set();
  const out = new Set<string>();
  for (const t of s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)) {
    if (t.length >= 4 && !STOP_TOKENS.has(t)) out.add(t);
  }
  return out;
}

function dedupeKey(env: SignalEnvelope, tokens: Set<string>): string {
  // Per-origin key so a re-fire from the SAME limb collapses (timer is
  // reset). Cross-limb matches are detected separately via token overlap.
  const base =
    env.subject?.trim().toLowerCase() ||
    Array.from(tokens).sort().join(" ") ||
    env.headline.toLowerCase();
  return `${env.origin}::${base}`;
}

function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const t of a) if (b.has(t)) return true;
  return false;
}

function originBadge(env: SignalEnvelope): string {
  const display = env.origin === "ephemeroi" ? "Ephemeroi" : "Metacog";
  return `[${display} · ${env.role}]`;
}

function evidenceFormatted(env: SignalEnvelope): string | null {
  const v = env.evidence?.["formatted"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function renderSingle(env: SignalEnvelope): string {
  const sevPct = Math.round(env.severity * 100);
  const lines: string[] = [`${originBadge(env)}  severity ${sevPct}/100`];
  const formatted = evidenceFormatted(env);
  if (formatted) {
    lines.push("");
    lines.push(formatted);
  } else {
    lines.push("");
    lines.push(env.headline);
    if (env.body && env.body !== env.headline) {
      lines.push("");
      lines.push(env.body);
    }
  }
  return lines.join("\n");
}

function renderLimbBlock(env: SignalEnvelope): string {
  const formatted = evidenceFormatted(env);
  if (formatted) return formatted;
  if (env.body && env.body !== env.headline) {
    return `${env.headline}\n${env.body}`;
  }
  return env.headline;
}

function renderMerged(
  a: SignalEnvelope,
  b: SignalEnvelope,
  kind: "merge" | "follow",
): string {
  // Canonical order: Ephemeroi first, Metacog second, regardless of arrival.
  const [ep, mc] = a.origin === "ephemeroi" ? [a, b] : [b, a];
  const sev = Math.max(a.severity, b.severity);
  const sevPct = Math.round(sev * 100);
  const subject = ep.subject ?? mc.subject ?? a.subject ?? b.subject ?? "(no subject)";
  const banner =
    kind === "merge"
      ? "[Cross-limb · ephemeroi+metacog]"
      : "[Cross-limb correlation · ephemeroi+metacog]";
  return [
    `${banner}  severity ${sevPct}/100`,
    `Subject: ${subject}`,
    "",
    `── Ephemeroi · ${ep.role} ──`,
    renderLimbBlock(ep),
    "",
    `── Metacog · ${mc.role} ──`,
    renderLimbBlock(mc),
  ].join("\n");
}

function pruneRecent(): void {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  while (recent.length > 0 && recent[0]!.sentAt < cutoff) recent.shift();
  while (recent.length > MAX_RECENT_ENTRIES) recent.shift();
}

function recordRecent(env: SignalEnvelope, tokens: Set<string>): void {
  recent.push({ envelope: env, tokens, sentAt: Date.now() });
  pruneRecent();
}

async function deliver(text: string, kind: string): Promise<void> {
  // Always log the rendered message — that's the audit trail when Telegram
  // isn't configured.
  logger.info(
    { kind, lines: text.split("\n").length },
    `unified telegram ${kind}\n${text}`,
  );
  if (!isTelegramConfigured()) return;
  try {
    await sendTelegramText(text);
  } catch (err) {
    logger.warn({ err, kind }, "convergence: telegram delivery failed");
  }
}

function handleSignal(env: SignalEnvelope): void {
  const tokens = tokenize(env.subject);

  // 1. Counterpart still in the merge buffer → cancel and emit ONE merge.
  for (const [pkey, entry] of pending) {
    if (entry.envelope.origin === env.origin) continue;
    if (!tokensOverlap(tokens, entry.tokens)) continue;
    clearTimeout(entry.timer);
    pending.delete(pkey);
    const merged = renderMerged(env, entry.envelope, "merge");
    recordRecent(env, tokens);
    recordRecent(entry.envelope, entry.tokens);
    void deliver(merged, "cross-limb merge");
    return;
  }

  // 2. Counterpart already sent within RECENT_WINDOW_MS → correlation follow-up.
  if (tokens.size > 0) {
    pruneRecent();
    for (const r of recent) {
      if (r.envelope.origin === env.origin) continue;
      if (!tokensOverlap(tokens, r.tokens)) continue;
      const merged = renderMerged(env, r.envelope, "follow");
      recordRecent(env, tokens);
      void deliver(merged, "cross-limb correlation");
      return;
    }
  }

  // 3. Schedule a single-limb send after the merge window — gives a
  //    near-simultaneous counterpart a chance to fold in.
  const key = dedupeKey(env, tokens);
  const existing = pending.get(key);
  if (existing) {
    // Same-origin re-fire on the same subject while a send is pending. Don't
    // reset the timer (that would let a chatty source starve the queue) and
    // don't drop information: keep the higher-severity envelope. Tokens are
    // re-unioned so a slightly different subject still merges with a later
    // counterpart from the OTHER limb.
    if (env.severity > existing.envelope.severity) existing.envelope = env;
    for (const t of tokens) existing.tokens.add(t);
    return;
  }
  const timer = setTimeout(() => {
    const cur = pending.get(key);
    if (!cur) return;
    pending.delete(key);
    const text = renderSingle(cur.envelope);
    recordRecent(cur.envelope, cur.tokens);
    void deliver(text, `single-limb ${cur.envelope.origin}`);
  }, MERGE_DELAY_MS);
  pending.set(key, { envelope: env, tokens, arrivedAt: Date.now(), timer });
}

let started = false;
export function startConvergence(): void {
  if (started) return;
  started = true;
  signalBus.on("signal", (env: SignalEnvelope) => {
    try {
      handleSignal(env);
    } catch (err) {
      logger.error({ err, envelope: env }, "convergence handler crashed");
    }
  });
  logger.info(
    { mergeDelayMs: MERGE_DELAY_MS, recentWindowMs: RECENT_WINDOW_MS },
    "Unified convergence subscriber started",
  );
}

// Test-only hooks. Not exported through index.ts.
export const __testing = {
  reset(): void {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    recent.length = 0;
  },
  pendingSize: () => pending.size,
  recentSize: () => recent.length,
};
