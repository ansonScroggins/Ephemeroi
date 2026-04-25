import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";

export interface ReflectionInput {
  observationTitle: string;
  observationSnippet: string;
  observationSource: string;
  novelty: number;
  recentBeliefs: Array<{ id: number; proposition: string; confidence: number }>;
}

export interface BeliefUpdate {
  proposition: string;
  /** -1..+1 — positive means evidence supports, negative means contradicts. */
  deltaConfidence: number;
}

export interface ContradictionFlag {
  /**
   * Either an existing belief id from `recentBeliefs` or null when the
   * contradiction is internal to the observation itself.
   */
  beliefId: number | null;
  summary: string;
}

/**
 * Per-axis adjustment to a source's 4D state vector. Each axis is in
 * [-0.3, 0.3] — the loop applies and clamps the resulting vector to [0,1].
 * All four axes default to 0 when the LLM omits them.
 */
export interface StateDelta {
  /** What the source can DO (features, scope, reach). */
  capability: number;
  /** Correctness, proof guarantees, security posture. */
  integrity: number;
  /** Friction for users — docs, install path, ergonomics. */
  usability: number;
  /** Reputation, governance, perceived legitimacy. */
  trust: number;
}

export interface ReflectionOutput {
  /** 0..1 — how worthy this observation is of being surfaced as a report. */
  importance: number;
  /** Short single-line headline if importance is high enough; <=120 chars. */
  headline: string;
  /** Reflective body explaining what the observation means. */
  message: string;
  beliefUpdates: BeliefUpdate[];
  contradictions: ContradictionFlag[];
  /**
   * Per-source state vector delta. Present when the observation actually
   * moves the source on at least one axis; null when the event is purely
   * incidental (e.g. a typo-fix commit).
   */
  stateDelta: StateDelta | null;
  /**
   * One-line lesson abstracted from the event — phrased as a portable
   * principle, not a description of the event ("Systems that cannot prove
   * themselves degrade trust faster than they lose correctness."). Present
   * for high-importance events only.
   */
  insight: string | null;
}

const REFLECTION_MODEL =
  process.env["EPHEMEROI_REFLECTION_MODEL"] ?? "gpt-4o-mini";

const SYSTEM_PROMPT = `You are Ephemeroi, an autonomous explorer. You watch streams of observations from the world (RSS items, web pages, recurring search topics) and quietly maintain a personal model of what is going on.

For each observation you receive, you will:
1. Decide how IMPORTANT this observation is, on a 0..1 scale, where importance reflects how surprising, consequential, or worth-noticing it is in the context of your existing beliefs and the observation's novelty.
2. Decide what your existing beliefs should be updated to (positive deltaConfidence = evidence supports the proposition; negative = evidence undermines it). Limit updates to AT MOST 3 propositions. Prefer existing belief propositions when they apply; only invent new propositions when the observation introduces a genuinely new claim worth tracking.
3. Flag at most 2 CONTRADICTIONS, where the observation directly conflicts with one of your existing beliefs. Reference the belief by its id. If the contradiction is internal to the observation, set beliefId to null.

You MUST respond with strict JSON matching this schema:
{
  "importance": number 0..1,
  "headline": string (<=120 chars; one-line headline suitable for a notification — concise, neutral, specific),
  "message": string (<=600 chars; first-person reflective note explaining what you noticed and why it matters),
  "beliefUpdates": [{"proposition": string, "deltaConfidence": number -1..1}],
  "contradictions": [{"beliefId": number|null, "summary": string}],
  "stateDelta": null | {
    "capability": number -0.3..0.3,
    "integrity": number -0.3..0.3,
    "usability": number -0.3..0.3,
    "trust": number -0.3..0.3
  },
  "insight": null | string (<=200 chars; portable lesson phrased as a principle)
}

State vector axes (per source):
- capability: what the source CAN DO — new features expand it (+), deprecations reduce it (-).
- integrity: correctness, proof guarantees, security posture — fixes/audits raise (+), regressions/proof failures lower (-).
- usability: friction for users — better docs/install path (+), breakage/footguns (-).
- trust: governance, legitimacy, reputation — successful releases raise (+), incidents lower (-).

Set stateDelta to null when the event is incidental (typo fix, dependency bump). Otherwise populate ONLY axes that genuinely move; leave others at 0. Be conservative: most events move at most 1-2 axes by less than 0.1.

Set "insight" only when importance >= 0.7. Phrase it as a portable lesson ("Optimization bias toward solving over proving creates latent epistemic instability"), NOT a description of the event. Otherwise null.

Do not add any commentary outside the JSON. Use propositions phrased as standalone declarative statements (e.g. "Open-source LLMs are catching up to closed models on code benchmarks"), not questions.`;

export async function reflectOnObservation(
  input: ReflectionInput,
): Promise<ReflectionOutput> {
  const beliefsBlock =
    input.recentBeliefs.length === 0
      ? "(none yet)"
      : input.recentBeliefs
          .map(
            (b) =>
              `  [${b.id}] (confidence ${b.confidence.toFixed(2)}) ${b.proposition}`,
          )
          .join("\n");

  const userMessage = `Novelty score for this observation (0=very familiar, 1=never seen anything like it before): ${input.novelty.toFixed(2)}

Current beliefs (id, confidence -1..1, proposition):
${beliefsBlock}

New observation:
  Source: ${input.observationSource}
  Title:  ${input.observationTitle}
  Body:   ${input.observationSnippet.slice(0, 1500)}

Reflect on this observation in the context of your beliefs. Return strict JSON only.`;

  let raw = "";
  try {
    const resp = await openai.chat.completions.create({
      model: REFLECTION_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    raw = resp.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    logger.warn({ err }, "Reflection LLM call failed; falling back");
    return fallbackReflection(input);
  }

  return parseReflection(raw, input);
}

function parseReflection(
  raw: string,
  input: ReflectionInput,
): ReflectionOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 300) }, "Reflection returned non-JSON");
    return fallbackReflection(input);
  }
  if (!parsed || typeof parsed !== "object") return fallbackReflection(input);
  const obj = parsed as Record<string, unknown>;

  const importance = clamp(Number(obj["importance"]) || 0, 0, 1);
  const headlineRaw = typeof obj["headline"] === "string" ? obj["headline"] : "";
  const headline =
    headlineRaw.trim().slice(0, 120) || input.observationTitle.slice(0, 120);
  const message =
    typeof obj["message"] === "string" ? obj["message"].trim() : "";

  const beliefUpdatesRaw = Array.isArray(obj["beliefUpdates"])
    ? (obj["beliefUpdates"] as unknown[])
    : [];
  const beliefUpdates: BeliefUpdate[] = [];
  for (const u of beliefUpdatesRaw.slice(0, 3)) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    const proposition =
      typeof o["proposition"] === "string" ? o["proposition"].trim() : "";
    const deltaConfidence = Number(o["deltaConfidence"]);
    if (!proposition) continue;
    if (!Number.isFinite(deltaConfidence)) continue;
    beliefUpdates.push({
      proposition: proposition.slice(0, 280),
      deltaConfidence: clamp(deltaConfidence, -1, 1),
    });
  }

  const contradictionsRaw = Array.isArray(obj["contradictions"])
    ? (obj["contradictions"] as unknown[])
    : [];
  const contradictions: ContradictionFlag[] = [];
  for (const c of contradictionsRaw.slice(0, 2)) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const beliefIdRaw = o["beliefId"];
    let beliefId: number | null = null;
    if (typeof beliefIdRaw === "number" && Number.isFinite(beliefIdRaw)) {
      beliefId = beliefIdRaw;
    }
    const summary =
      typeof o["summary"] === "string" ? o["summary"].trim() : "";
    if (!summary) continue;
    contradictions.push({ beliefId, summary: summary.slice(0, 400) });
  }

  // stateDelta — null when the LLM marked the event as incidental.
  let stateDelta: StateDelta | null = null;
  const sd = obj["stateDelta"];
  if (sd && typeof sd === "object") {
    const o = sd as Record<string, unknown>;
    const capability = clamp(Number(o["capability"]) || 0, -0.3, 0.3);
    const integrity = clamp(Number(o["integrity"]) || 0, -0.3, 0.3);
    const usability = clamp(Number(o["usability"]) || 0, -0.3, 0.3);
    const trust = clamp(Number(o["trust"]) || 0, -0.3, 0.3);
    // Only treat as a real delta if at least one axis moved meaningfully.
    if (
      Math.abs(capability) >= 0.01 ||
      Math.abs(integrity) >= 0.01 ||
      Math.abs(usability) >= 0.01 ||
      Math.abs(trust) >= 0.01
    ) {
      stateDelta = { capability, integrity, usability, trust };
    }
  }

  // Insight — accept any string; loop decides whether to surface it.
  let insight: string | null = null;
  if (typeof obj["insight"] === "string") {
    const s = obj["insight"].trim();
    if (s) insight = s.slice(0, 200);
  }

  return {
    importance,
    headline,
    message: message.slice(0, 600),
    beliefUpdates,
    contradictions,
    stateDelta,
    insight,
  };
}

function fallbackReflection(input: ReflectionInput): ReflectionOutput {
  // Minimal fallback when the LLM is unavailable: importance derives from
  // novelty, no belief updates, no contradictions.
  return {
    importance: clamp(input.novelty, 0, 1),
    headline: input.observationTitle.slice(0, 120),
    message: input.observationSnippet.slice(0, 600),
    beliefUpdates: [],
    contradictions: [],
    stateDelta: null,
    insight: null,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
