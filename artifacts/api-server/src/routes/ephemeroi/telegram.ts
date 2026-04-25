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
