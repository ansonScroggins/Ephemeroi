import { logger } from "../../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";
import { upsertTopicBelief, type TopicBeliefRow } from "./store";

/**
 * Topic-belief extraction: after every Telegram answer (typed Q&A or PDF
 * read), pass the (question, answer) to a small LLM extractor that returns
 * zero or more concrete `{subject, stance, confidence, evidence}` records.
 * Each one is upserted into `ephemeroi_topic_beliefs` autonomously — there
 * is no human in the loop. The user explicitly chose this "broad" shape
 * over the safer narrow shape, knowing it can write a belief about any
 * subject mentioned in any exchange.
 *
 * Failure mode: extraction is fire-and-forget. If the model returns
 * malformed JSON, or no concrete beliefs, or the call errors, we log and
 * move on — the user has already received their answer. Belief writing is
 * a side effect of conversation, not a blocker for it.
 */

// Hard cap so a single exchange can't generate a runaway list of beliefs.
const MAX_BELIEFS_PER_EXCHANGE = 5;
// Skip extraction if the answer was a self-explanatory error string — no
// useful belief comes from "Sorry — I couldn't answer that."
const ANSWER_MIN_CHARS = 80;
// Trim oversized inputs before extraction. The extractor itself doesn't need
// the full PDF — only the question + the assistant's reply, which is already
// capped by the answer pipeline (≤ 2500 chars per the system prompt).
const MAX_EXTRACTION_INPUT_CHARS = 6000;

export type TopicBeliefSourceKind = "qa" | "pdf";

interface ExtractedBelief {
  subject: string;
  stance: string;
  confidence: number;
  evidence?: string;
}

const EXTRACTION_SYSTEM = [
  "You are extracting topic beliefs from a single Q&A exchange.",
  "Given the user's question and the assistant's answer, return the concrete *opinionated stances* the assistant now holds about specific named subjects.",
  "Each belief must be about a SPECIFIC NAMED SUBJECT (a product, person, company, technology, event, work, place, etc.) — not a generic concept.",
  "Stances must be substantive opinions or factual takes — not summaries of what the user asked, not meta-commentary about the conversation.",
  "Confidence reflects how strongly the exchange supports the stance: 0.3 = weak/tentative, 0.6 = moderate, 0.9 = strong/well-evidenced.",
  "Return STRICT JSON only — no markdown, no commentary, no code fences.",
  `Schema: {"beliefs": [{"subject": "...", "stance": "...", "confidence": 0.0-1.0, "evidence": "..."}]}`,
  `Return {"beliefs": []} if the exchange formed no concrete topic-level stances (e.g. small talk, /help, a refusal, a math computation).`,
  `Cap at ${MAX_BELIEFS_PER_EXCHANGE} beliefs.`,
].join(" ");

/**
 * Extract topic beliefs from a (question, answer) pair and upsert each one.
 * Runs detached — the caller awaits nothing. Returns the upserted rows for
 * tests / inspection but the Telegram path ignores the return.
 */
export async function extractAndUpsertTopicBeliefs(
  question: string,
  answer: string,
  sourceKind: TopicBeliefSourceKind,
): Promise<TopicBeliefRow[]> {
  if (!question.trim() || !answer.trim()) return [];
  if (answer.trim().length < ANSWER_MIN_CHARS) return [];
  // Skip clear non-substantive paths
  const trimmedQ = question.trim();
  if (trimmedQ === "/start" || trimmedQ === "/help") return [];
  if (answer.startsWith("Sorry —") || answer.startsWith("I'm Ephemeroi.")) {
    return [];
  }

  const trimQ =
    question.length > MAX_EXTRACTION_INPUT_CHARS
      ? question.slice(0, MAX_EXTRACTION_INPUT_CHARS) + "…"
      : question;
  const trimA =
    answer.length > MAX_EXTRACTION_INPUT_CHARS
      ? answer.slice(0, MAX_EXTRACTION_INPUT_CHARS) + "…"
      : answer;

  let extracted: ExtractedBelief[];
  try {
    extracted = await callExtractor(trimQ, trimA);
  } catch (err) {
    logger.warn(
      { err, qPreview: trimQ.slice(0, 120) },
      "topicBeliefs: extraction call failed",
    );
    return [];
  }

  if (extracted.length === 0) {
    logger.debug(
      { qPreview: trimQ.slice(0, 120) },
      "topicBeliefs: no concrete beliefs extracted",
    );
    return [];
  }

  const upserted: TopicBeliefRow[] = [];
  for (const b of extracted.slice(0, MAX_BELIEFS_PER_EXCHANGE)) {
    if (!isValidBelief(b)) continue;
    try {
      const row = await upsertTopicBelief({
        subject: b.subject,
        stance: b.stance,
        confidence: b.confidence,
        evidence: b.evidence,
        sourceKind,
        question: trimQ,
      });
      upserted.push(row);
    } catch (err) {
      logger.warn(
        { err, subject: b.subject },
        "topicBeliefs: upsert failed for one belief; continuing",
      );
    }
  }

  if (upserted.length > 0) {
    logger.info(
      {
        count: upserted.length,
        subjects: upserted.map((r) => r.subject),
        sourceKind,
      },
      "topicBeliefs: autonomous belief update",
    );
  }
  return upserted;
}

async function callExtractor(
  question: string,
  answer: string,
): Promise<ExtractedBelief[]> {
  const userPrompt =
    `User question:\n${question}\n\n` +
    `Assistant answer:\n${answer}\n\n` +
    `Extract topic beliefs as strict JSON.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });
  const raw = resp.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "topicBeliefs: extractor returned non-JSON");
    return [];
  }
  // Tolerate either { beliefs: [...] } (the prompted shape) or a bare array
  // (the model occasionally inlines it despite the schema).
  const arr =
    Array.isArray(parsed)
      ? parsed
      : (parsed as { beliefs?: unknown[] }).beliefs ?? [];
  if (!Array.isArray(arr)) return [];
  return arr.filter(isValidBelief);
}

function isValidBelief(x: unknown): x is ExtractedBelief {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b["subject"] === "string" &&
    (b["subject"] as string).trim().length > 0 &&
    (b["subject"] as string).length <= 200 &&
    typeof b["stance"] === "string" &&
    (b["stance"] as string).trim().length > 0 &&
    (b["stance"] as string).length <= 600 &&
    typeof b["confidence"] === "number" &&
    Number.isFinite(b["confidence"]) &&
    (b["confidence"] as number) >= 0 &&
    (b["confidence"] as number) <= 1 &&
    (b["evidence"] === undefined || typeof b["evidence"] === "string")
  );
}
