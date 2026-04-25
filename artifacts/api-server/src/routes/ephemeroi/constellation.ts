import { logger } from "../../lib/logger";
import { askDon } from "./don";
import type { ReportRow, SourceStateRow } from "./store";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * The Constellation alert path is what fires when something genuinely
 * shifts the picture. It exists so an alert FEELS different from a normal
 * report — same delivery channel (Telegram), but with a four-axis state
 * snapshot, the lesson Ephemeroi extracted, and a Don/Wife/Son narration.
 *
 * The shape is deliberately printable as plain text so it shows up
 * usefully even if Telegram is unreachable (we log the formatted body) and
 * even if the Markdown parse fails on the Telegram side.
 */

export interface ConstellationAlert {
  reportId: number;
  sourceLabel: string;
  sourceTarget: string;
  headline: string;
  importance: number;
  vector: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  delta: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  insight: string | null;
  donNarration: string;
  donSource: "ollama" | "openai" | "stub";
  formatted: string;
}

/**
 * Compose the alert: format the four-axis snapshot, ask the Don for a
 * narration, and produce a single printable block. Always returns an
 * alert object even if the Don voice or Telegram fail — the caller logs
 * the formatted text as part of the audit trail.
 */
export async function composeConstellationAlert(input: {
  report: ReportRow;
  sourceLabel: string;
  sourceTarget: string;
  state: SourceStateRow;
}): Promise<ConstellationAlert> {
  const { report, sourceLabel, sourceTarget, state } = input;
  const importance = report.importance;

  const vector = {
    capability: state.capability,
    integrity: state.integrity,
    usability: state.usability,
    trust: state.trust,
  };
  const delta = {
    capability: state.lastDeltaCapability,
    integrity: state.lastDeltaIntegrity,
    usability: state.lastDeltaUsability,
    trust: state.lastDeltaTrust,
  };

  // Ask the Don for narration. We pass the structured event in plain
  // language so the model can reason about it without us pre-baking the
  // conclusion.
  const donPrompt = buildDonPrompt({
    sourceLabel,
    sourceTarget,
    headline: report.headline,
    body: report.body,
    importance,
    vector,
    delta,
    insight: state.lastInsight,
  });
  const don = await askDon(donPrompt);

  const formatted = formatAlert({
    sourceLabel,
    sourceTarget,
    headline: report.headline,
    body: report.body,
    importance,
    vector,
    delta,
    insight: state.lastInsight,
    donNarration: don.text,
  });

  return {
    reportId: report.id,
    sourceLabel,
    sourceTarget,
    headline: report.headline,
    importance,
    vector,
    delta,
    insight: state.lastInsight,
    donNarration: don.text,
    donSource: don.source,
    formatted,
  };
}

/**
 * Send the alert via Telegram. Mirrors `sendTelegramReport`'s approach but
 * with a richer body and no Markdown parse mode so the table-ish layout
 * survives intact. Returns true on 2xx delivery.
 */
export async function sendConstellationAlert(
  alert: ConstellationAlert,
): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    logger.debug(
      "Telegram not configured; constellation alert printed to log only",
    );
    return false;
  }
  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: alert.formatted,
        // No parse_mode — the body uses unicode arrows + plain ASCII so
        // we don't have to escape anything against Telegram's pickier
        // Markdown parser.
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn(
        { status: resp.status, body: body.slice(0, 500) },
        "Telegram constellation send failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Telegram constellation delivery error");
    return false;
  }
}

function buildDonPrompt(input: {
  sourceLabel: string;
  sourceTarget: string;
  headline: string;
  body: string;
  importance: number;
  vector: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  delta: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  insight: string | null;
}): string {
  const sev = Math.round(input.importance * 100);
  const lines = [
    `Source: ${input.sourceLabel} (${input.sourceTarget})`,
    `Severity: ${sev}/100`,
    `Headline: ${input.headline}`,
    `Body: ${input.body}`,
    "",
    "State movement (axis: new → was, delta):",
    formatAxisLineForPrompt("Capability", input.vector.capability, input.delta.capability),
    formatAxisLineForPrompt("Integrity",  input.vector.integrity,  input.delta.integrity),
    formatAxisLineForPrompt("Usability",  input.vector.usability,  input.delta.usability),
    formatAxisLineForPrompt("Trust",      input.vector.trust,      input.delta.trust),
  ];
  if (input.insight) {
    lines.push("", `Insight extracted: ${input.insight}`);
  }
  lines.push(
    "",
    "Explain to me, in your voice, what just happened to this source and what it means for whether I should keep trusting it. Be specific about the axis that moved most.",
  );
  return lines.join("\n");
}

function formatAxisLineForPrompt(
  axis: string,
  current: number,
  delta: number,
): string {
  const prev = current - delta;
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  return `  ${axis.padEnd(11)} ${prev.toFixed(2)} → ${current.toFixed(2)} (${sign}${delta.toFixed(2)})`;
}

function formatAlert(input: {
  sourceLabel: string;
  sourceTarget: string;
  headline: string;
  body: string;
  importance: number;
  vector: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  delta: {
    capability: number;
    integrity: number;
    usability: number;
    trust: number;
  };
  insight: string | null;
  donNarration: string;
}): string {
  const sev = Math.round(input.importance * 100);
  const lines: string[] = [];
  lines.push(`✦ Constellation alert — ${input.sourceLabel}`);
  lines.push(`severity ${sev}/100`);
  lines.push("");
  lines.push(input.headline);
  if (input.body && input.body !== input.headline) {
    lines.push("");
    lines.push(input.body);
  }
  lines.push("");
  lines.push("State vector:");
  lines.push(formatAxisLineForAlert("Capability", input.vector.capability, input.delta.capability));
  lines.push(formatAxisLineForAlert("Integrity",  input.vector.integrity,  input.delta.integrity));
  lines.push(formatAxisLineForAlert("Usability",  input.vector.usability,  input.delta.usability));
  lines.push(formatAxisLineForAlert("Trust",      input.vector.trust,      input.delta.trust));
  if (input.insight) {
    lines.push("");
    lines.push(`Insight: ${input.insight}`);
  }
  lines.push("");
  lines.push(input.donNarration);
  return lines.join("\n");
}

function formatAxisLineForAlert(
  axis: string,
  current: number,
  delta: number,
): string {
  // ▲ for positive moves, ▼ for negative, · for none. Keeps everything in
  // plain text so Telegram doesn't need a parse mode.
  const arrow = delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "·";
  const pct = Math.round(current * 100);
  const dpct = Math.round(delta * 100);
  const dStr =
    delta > 0.001 ? `+${dpct}` : delta < -0.001 ? `${dpct}` : "0";
  return `  ${axis.padEnd(11)} ${pct.toString().padStart(3)}/100  ${arrow} ${dStr}`;
}
