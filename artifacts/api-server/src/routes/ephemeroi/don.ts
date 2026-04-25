import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";

/**
 * The Don voice. When something significant moves the constellation,
 * Ephemeroi narrates it in the calm, strategic mob-boss persona — with
 * occasional asides from The Wife (strategic insight) and The Son
 * (activist perspective). The voice is intentionally a little theatrical
 * because the whole point of the Constellation alert is to make you FEEL
 * the disturbance, not parse a log line.
 *
 * Generation lives at a configurable Ollama-style endpoint so you can run
 * a local Mistral on your machine and watch Ephemeroi route through it.
 * If the endpoint is unreachable from wherever the api-server is running
 * (e.g. the Replit container can't see your laptop), we fall back to the
 * existing OpenAI integration with the same persona prompt — same voice,
 * different muscle.
 */

const DON_URL =
  process.env["EPHEMEROI_DON_URL"] ?? "http://localhost:11434/api/generate";
const DON_MODEL = process.env["EPHEMEROI_DON_MODEL"] ?? "mistral";
const DON_TIMEOUT_MS = Number(process.env["EPHEMEROI_DON_TIMEOUT_MS"] ?? 8000);

const DON_FALLBACK_MODEL =
  process.env["EPHEMEROI_DON_FALLBACK_MODEL"] ?? "gpt-4o-mini";

const DON_SYSTEM_PROMPT = `You are The Don. You speak in calm, strategic, mob-boss style. You explain things deeply and clearly. You occasionally include:
- The Wife (strategic insight)
- The Son (activist perspective)

Format conventions:
- Stay under 6 sentences total.
- Lead with The Don's voice. Bring in The Wife or The Son only when their angle adds something The Don alone wouldn't say.
- Mark each speaker on its own line, like:
    The Don: ...
    The Wife: ...
    The Son: ...
- No preamble, no apologies, no markdown headers. Just the lines.`;

export interface DonResult {
  text: string;
  /** Which path generated the text — useful for logs and the audit trail. */
  source: "ollama" | "openai" | "stub";
}

/**
 * Generate a Don/Wife/Son narration for the given prompt. Always returns
 * something — never throws — so callers can drop it straight into a
 * Telegram message or log line without extra error handling.
 */
export async function askDon(prompt: string): Promise<DonResult> {
  // 1. Try the Ollama-style endpoint first.
  const ollama = await tryOllama(prompt);
  if (ollama) {
    return { text: ollama, source: "ollama" };
  }

  // 2. Fall back to OpenAI with the same persona.
  try {
    const resp = await openai.chat.completions.create({
      model: DON_FALLBACK_MODEL,
      temperature: 0.6,
      messages: [
        { role: "system", content: DON_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    if (text) {
      return { text, source: "openai" };
    }
  } catch (err) {
    logger.warn({ err }, "Don voice: OpenAI fallback failed");
  }

  // 3. Last-resort stub so callers always get something printable.
  return {
    text: "The Don: (silent — neither the local oracle nor the cloud answered tonight.)",
    source: "stub",
  };
}

async function tryOllama(prompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DON_TIMEOUT_MS);
  try {
    const resp = await fetch(DON_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Match the user-provided pattern: pass the persona inline in the
      // prompt itself rather than via a separate "system" field, since
      // older Ollama versions only accept `prompt` for /api/generate.
      body: JSON.stringify({
        model: DON_MODEL,
        prompt: `${DON_SYSTEM_PROMPT}\n\nNow answer:\n\n${prompt}`,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      logger.debug(
        { status: resp.status, url: DON_URL },
        "Don voice: Ollama returned non-2xx; using fallback",
      );
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const text = typeof json["response"] === "string" ? json["response"].trim() : "";
    return text || null;
  } catch (err) {
    // Connection refused / DNS / timeout — quietly fall back. We log at
    // debug because in the deployed environment this is the *expected*
    // path (no Ollama on the container) and we don't want noisy warns.
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), url: DON_URL },
      "Don voice: Ollama unreachable; using fallback",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
