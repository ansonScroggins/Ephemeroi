import { logger } from "../../lib/logger";
import type { ReportRow } from "./store";

const TELEGRAM_API = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  return (
    !!process.env["TELEGRAM_BOT_TOKEN"] && !!process.env["TELEGRAM_CHAT_ID"]
  );
}

export async function sendTelegramReport(
  report: ReportRow,
): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    logger.debug(
      "Telegram not configured (missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID); skipping delivery",
    );
    return false;
  }
  const text = formatReportForTelegram(report);
  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn(
        { status: resp.status, body: body.slice(0, 500) },
        "Telegram sendMessage failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Telegram delivery error");
    return false;
  }
}

function formatReportForTelegram(report: ReportRow): string {
  const importance = Math.round(report.importance * 100);
  const safeHeadline = mdEscape(report.headline);
  const safeBody = mdEscape(report.body);
  return `*Ephemeroi report* — importance ${importance}\n\n*${safeHeadline}*\n\n${safeBody}`;
}

function mdEscape(s: string): string {
  // Minimal markdown escape for Telegram Markdown (legacy) parse mode.
  return s.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Send arbitrary text to the configured Telegram chat. Plain text only — no
 * Markdown parsing, so callers don't have to worry about escaping. Used by
 * self-improvement notifications and any other one-off operational message.
 * Returns false (without throwing) if Telegram isn't configured or the send
 * fails, so callers can chain it without a try/catch.
 */
export async function sendTelegramText(text: string): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    logger.debug(
      "Telegram not configured (missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID); skipping delivery",
    );
    return false;
  }
  // Telegram caps messages at 4096 chars. Truncate hard so a long diff
  // preview can't make the whole message bounce.
  const safe = text.length > 4000 ? `${text.slice(0, 3900)}\n…(truncated)` : text;
  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: safe,
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn(
        { status: resp.status, body: body.slice(0, 500) },
        "Telegram sendMessage (text) failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Telegram text delivery error");
    return false;
  }
}
