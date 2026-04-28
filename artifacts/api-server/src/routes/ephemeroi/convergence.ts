import {
  signalBus,
  type SignalEnvelope,
  type SignalDeliveryCallback,
} from "../../lib/signal-envelope";
import { logger } from "../../lib/logger";
import { sendTelegramText, isTelegramConfigured } from "./telegram";

// ============================================================================
// Unified Telegram convergence subscriber — strict single-message semantics
// ----------------------------------------------------------------------------
// Single subscriber on `signalBus` that owns all unified-stream Telegram
// delivery for both Ephemeroi (structural / constellation) and Metacog
// (truth-anchor / exploration).
//
// Convergence rule (matches Task #14 spec literally)
// --------------------------------------------------
// Every envelope is buffered under a per-(origin, normalized-subject) key for
// up to `EPHEMEROI_CONVERGENCE_WINDOW_MS` (default 5 min). Outcomes:
//
//   - Counterpart from the OTHER limb arrives during the window with an
//     overlapping subject  →  cancel its pending timer, emit a SINGLE
//     `[Cross-limb · ephemeroi+metacog]` message, fire the delivery callbacks
//     of BOTH envelopes with the (shared) Telegram outcome.
//
//   - Window expires with no counterpart  →  emit a SINGLE-LIMB
//     `[Origin · role]` message; fire that envelope's delivery callback.
//
// So any same-subject pair from different limbs that arrives within the
// window produces exactly ONE Telegram message — the explicit Task #14
// requirement.
//
// Trade-off
// ---------
// The first signal of a pair is held for up to WINDOW_MS waiting for its
// counterpart. For deployments that need lower-latency single-limb alerts
// (e.g. Ephemeroi structural cage detection), set
// `EPHEMEROI_CONVERGENCE_WINDOW_MS=30000` (30 s) or similar. The default is
// the spec value (5 min) so the literal acceptance criterion is met out of
// the box; operators tune it down if their alert latency requirements
// outweigh strict pair-merging.
//
// Subject overlap is intentionally simple: ≥1 significant token of length ≥4
// shared between normalized subjects, after a small stopword filter. v1
// conservatism — see follow-up Task #17 for the planned tightening.
//
// Same-origin burst dedupe
// ------------------------
// If the same limb re-fires on the same subject while one is still pending,
// we keep the highest-severity envelope (its content wins) and union the
// tokens, but DO NOT reset the timer (a chatty source can't starve the
// queue) and we chain any new delivery callback onto the existing one so
// every caller gets notified.
//
// Telegram failures are logged but never propagate. The fully-rendered text
// is always written to the structured log first, so the audit trail survives
// a missing/unreachable Telegram bot. Convergence is fire-and-forget from
// the producer's side (`signalBus.emit` is sync; delivery work is detached).
// ============================================================================

const WINDOW_MS = Number(
  process.env["EPHEMEROI_CONVERGENCE_WINDOW_MS"] ?? 5 * 60 * 1000,
);

// ----------------------------------------------------------------------------
// Burst tracking + 🚨 escalation prefix
// ----------------------------------------------------------------------------
// EWMA of arrivals per *subject* (origin-agnostic — cross-limb signals on the
// same topic compound), with exponential decay so a subject that goes quiet
// returns to baseline. Normalized to 0..1 by dividing by `BURST_NORMALIZATION`
// (sustained-arrival count that maps to burst=1.0) and clamped.
//
// A unified message is prefixed with 🚨 iff
//   severity >= ESCALATION_SEVERITY_THRESHOLD  AND
//   burst    >= ESCALATION_BURST_THRESHOLD
// at the moment of delivery (cross-limb merge or single-limb expiry). This
// is purely a render-layer change — convergence/merge semantics are unchanged.
// ----------------------------------------------------------------------------

const BURST_HALF_LIFE_MS = Number(
  process.env["EPHEMEROI_BURST_HALF_LIFE_MS"] ?? 5 * 60 * 1000,
);
const BURST_NORMALIZATION = Number(
  process.env["EPHEMEROI_BURST_NORMALIZATION"] ?? 5,
);
const ESCALATION_SEVERITY_THRESHOLD = Number(
  process.env["EPHEMEROI_ESCALATION_SEVERITY_THRESHOLD"] ?? 0.8,
);
const ESCALATION_BURST_THRESHOLD = Number(
  process.env["EPHEMEROI_ESCALATION_BURST_THRESHOLD"] ?? 0.8,
);
// Burst entries below this decayed EWMA are evicted on the next opportunistic
// prune (corresponds to ~6.6 half-lives of silence with normalization=5).
const BURST_PRUNE_EPSILON = 0.01;

interface BurstState { ewma: number; lastTickMs: number; }
const burstState: Map<string, BurstState> = new Map();

function decayFactor(dtMs: number): number {
  if (dtMs <= 0) return 1;
  return Math.pow(0.5, dtMs / BURST_HALF_LIFE_MS);
}

function pruneBurst(now: number): void {
  for (const [k, s] of burstState) {
    const decayed = s.ewma * decayFactor(now - s.lastTickMs);
    if (decayed < BURST_PRUNE_EPSILON) burstState.delete(k);
  }
}

function tickBurst(key: string, now: number): number {
  if (!key) return 0;
  // Prune BEFORE the branch so the first-seen-key path also reclaims memory.
  // Otherwise high-cardinality one-off subject traffic can grow burstState
  // unbounded (each first-seen key returns early without pruning).
  pruneBurst(now);
  const s = burstState.get(key);
  if (!s) {
    burstState.set(key, { ewma: 1, lastTickMs: now });
    return Math.min(1, 1 / BURST_NORMALIZATION);
  }
  s.ewma = s.ewma * decayFactor(now - s.lastTickMs) + 1;
  s.lastTickMs = now;
  return Math.min(1, s.ewma / BURST_NORMALIZATION);
}

function readBurst(key: string, now: number): number {
  if (!key) return 0;
  const s = burstState.get(key);
  if (!s) return 0;
  const decayed = s.ewma * decayFactor(now - s.lastTickMs);
  return Math.min(1, decayed / BURST_NORMALIZATION);
}

function shouldEscalate(severity: number, burst: number): boolean {
  return (
    severity >= ESCALATION_SEVERITY_THRESHOLD &&
    burst >= ESCALATION_BURST_THRESHOLD
  );
}

function escalationPrefix(severity: number, burst: number): string {
  return shouldEscalate(severity, burst) ? "🚨 " : "";
}

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
  // Chained delivery callback — set by `bindCallback` so successive
  // same-key publishes all get notified of the eventual Telegram outcome.
  onDelivered?: SignalDeliveryCallback;
}

const pending: Map<string, PendingEntry> = new Map();

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

function subjectKey(env: SignalEnvelope, tokens: Set<string>): string {
  // Origin-agnostic key — used both for burst tracking (which compounds
  // across limbs on the same topic) and as the base for the per-origin
  // dedupe key below.
  return (
    env.subject?.trim().toLowerCase() ||
    Array.from(tokens).sort().join(" ") ||
    env.headline.toLowerCase()
  );
}

function dedupeKey(env: SignalEnvelope, tokens: Set<string>): string {
  // Per-origin key so a re-fire from the SAME limb collapses (severity-wins,
  // timer NOT reset). Cross-limb matches are detected separately via token
  // overlap before we ever consult this key.
  return `${env.origin}::${subjectKey(env, tokens)}`;
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

function renderSingle(env: SignalEnvelope, burst: number): string {
  const sevPct = Math.round(env.severity * 100);
  const prefix = escalationPrefix(env.severity, burst);
  const lines: string[] = [`${prefix}${originBadge(env)}  severity ${sevPct}/100`];
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

function renderMerged(a: SignalEnvelope, b: SignalEnvelope, burst: number): string {
  // Canonical order: Ephemeroi first, Metacog second, regardless of arrival.
  const [ep, mc] = a.origin === "ephemeroi" ? [a, b] : [b, a];
  const sev = Math.max(a.severity, b.severity);
  const sevPct = Math.round(sev * 100);
  const prefix = escalationPrefix(sev, burst);
  const subject =
    ep.subject ?? mc.subject ?? a.subject ?? b.subject ?? "(no subject)";
  return [
    `${prefix}[Cross-limb · ephemeroi+metacog]  severity ${sevPct}/100`,
    `Subject: ${subject}`,
    "",
    `── Ephemeroi · ${ep.role} ──`,
    renderLimbBlock(ep),
    "",
    `── Metacog · ${mc.role} ──`,
    renderLimbBlock(mc),
  ].join("\n");
}

function chainCallback(
  prev: SignalDeliveryCallback | undefined,
  next: SignalDeliveryCallback | undefined,
): SignalDeliveryCallback | undefined {
  if (!prev) return next;
  if (!next) return prev;
  return (success: boolean): void => {
    try { prev(success); } catch (err) {
      logger.warn({ err }, "convergence: onDelivered callback threw");
    }
    try { next(success); } catch (err) {
      logger.warn({ err }, "convergence: onDelivered callback threw");
    }
  };
}

async function deliver(
  text: string,
  kind: string,
  callbacks: Array<SignalDeliveryCallback | undefined>,
): Promise<void> {
  // Always log the rendered message — that's the audit trail when Telegram
  // isn't configured.
  logger.info(
    { kind, lines: text.split("\n").length },
    `unified telegram ${kind}\n${text}`,
  );
  let success = false;
  if (isTelegramConfigured()) {
    try {
      // sendTelegramText resolves with FALSE on Telegram API rejection
      // (e.g. invalid bot token, banned chat) without throwing — so we
      // must inspect the return value, not just the absence of an error.
      success = await sendTelegramText(text);
      if (!success) {
        logger.warn({ kind }, "convergence: telegram send returned false");
      }
    } catch (err) {
      logger.warn({ err, kind }, "convergence: telegram delivery threw");
      success = false;
    }
  }
  for (const cb of callbacks) {
    if (!cb) continue;
    try { cb(success); } catch (err) {
      logger.warn({ err, kind }, "convergence: onDelivered callback threw");
    }
  }
}

function handleSignal(
  env: SignalEnvelope,
  onDelivered: SignalDeliveryCallback | undefined,
): void {
  const tokens = tokenize(env.subject);
  const sKey = subjectKey(env, tokens);
  const now = Date.now();
  // Tick burst on EVERY arrival (origin-agnostic) so cross-limb chatter on
  // the same topic compounds. The merge / single-limb paths below read the
  // current burst at delivery time.
  const burst = tickBurst(sKey, now);

  // 1. Counterpart still pending → cancel its timer, emit ONE merge,
  //    fire BOTH envelopes' delivery callbacks with the shared outcome.
  //    If anything between extracting the counterpart and scheduling
  //    delivery throws, fail BOTH callbacks so neither caller is stranded.
  for (const [pkey, entry] of pending) {
    if (entry.envelope.origin === env.origin) continue;
    if (!tokensOverlap(tokens, entry.tokens)) continue;
    clearTimeout(entry.timer);
    pending.delete(pkey);
    const counterpartCb = entry.onDelivered;
    try {
      const merged = renderMerged(env, entry.envelope, burst);
      void deliver(merged, "cross-limb merge", [onDelivered, counterpartCb]);
    } catch (err) {
      logger.error(
        { err, envelope: env, counterpart: entry.envelope },
        "convergence: merge-path crashed; failing both callbacks",
      );
      try { onDelivered?.(false); } catch { /* ignore */ }
      try { counterpartCb?.(false); } catch { /* ignore */ }
    }
    return;
  }

  // 2. Same-origin re-fire → keep highest severity, union tokens, chain
  //    the new delivery callback onto the existing one. DO NOT reset the
  //    timer — that would let a chatty source starve the queue.
  const key = dedupeKey(env, tokens);
  const existing = pending.get(key);
  if (existing) {
    if (env.severity > existing.envelope.severity) existing.envelope = env;
    for (const t of tokens) existing.tokens.add(t);
    existing.onDelivered = chainCallback(existing.onDelivered, onDelivered);
    return;
  }

  // 3. New entry: buffer for the full window. If a counterpart from the
  //    OTHER limb arrives during this time we'll branch into case (1) and
  //    cancel this timer; otherwise we emit a single-limb message and fire
  //    the delivery callback with the Telegram outcome. Burst is read
  //    fresh at fire time (it decays during the wait).
  const timer = setTimeout(() => {
    const cur = pending.get(key);
    if (!cur) return;
    pending.delete(key);
    const burstNow = readBurst(sKey, Date.now());
    const text = renderSingle(cur.envelope, burstNow);
    void deliver(text, `single-limb ${cur.envelope.origin}`, [cur.onDelivered]);
  }, WINDOW_MS);
  pending.set(key, {
    envelope: env,
    tokens,
    arrivedAt: now,
    timer,
    onDelivered,
  });
}

let started = false;
export function startConvergence(): void {
  if (started) return;
  started = true;
  signalBus.on(
    "signal",
    (env: SignalEnvelope, onDelivered?: SignalDeliveryCallback) => {
      try {
        handleSignal(env, onDelivered);
      } catch (err) {
        logger.error({ err, envelope: env }, "convergence handler crashed");
        // Don't leave the producer hanging.
        try { onDelivered?.(false); } catch { /* ignore */ }
      }
    },
  );
  logger.info(
    {
      windowMs: WINDOW_MS,
      burstHalfLifeMs: BURST_HALF_LIFE_MS,
      burstNormalization: BURST_NORMALIZATION,
      escalationSeverityThreshold: ESCALATION_SEVERITY_THRESHOLD,
      escalationBurstThreshold: ESCALATION_BURST_THRESHOLD,
    },
    "Unified convergence subscriber started",
  );
}

// Test-only hooks. Not exported through index.ts.
export const __testing = {
  reset(): void {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    burstState.clear();
  },
  pendingSize: () => pending.size,
  windowMs: () => WINDOW_MS,
  burstSize: () => burstState.size,
  readBurst: (key: string) => readBurst(key, Date.now()),
};
