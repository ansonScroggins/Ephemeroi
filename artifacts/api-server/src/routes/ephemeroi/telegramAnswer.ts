import { logger } from "../../lib/logger";
import { sendTelegramText } from "./telegram";
import { openai } from "@workspace/integrations-openai-ai-server";

/**
 * Inbound Telegram message handler. Long-polls the Bot API for new messages
 * from the configured TELEGRAM_CHAT_ID, asks GPT-4o-mini (with the built-in
 * web_search tool) to answer them, and replies via sendTelegramText.
 *
 * Single user gate: only messages from TELEGRAM_CHAT_ID are answered. Every
 * other chat is silently ignored. Telegram itself is the auth boundary.
 *
 * Long-polling instead of webhooks so the bot works in any environment
 * (dev, deploy, behind NAT) without registering a public callback URL.
 */

const TELEGRAM_API = "https://api.telegram.org";
const POLL_TIMEOUT_S = 25;
const ERROR_BACKOFF_MS = 5000;
const MAX_QUESTION_CHARS = 4000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

interface ResponsesAnnotation {
  type?: string;
  url?: string;
  title?: string;
}
interface ResponsesContent {
  text?: string;
  annotations?: ResponsesAnnotation[];
}
interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesContent[];
}

let started = false;
let stopRequested = false;
let lastUpdateId = 0;

function isConfigured(): boolean {
  return !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]);
}

function allowedChatId(): number | null {
  const raw = process.env["TELEGRAM_CHAT_ID"];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Optional second gate: if TELEGRAM_ALLOWED_USER_IDS is set (comma-separated
 * Telegram user IDs), only those senders are answered. Useful when
 * TELEGRAM_CHAT_ID is a group/supergroup — without this gate any group
 * member could burn OpenAI tokens. When unset, chat-id is the only gate.
 */
function allowedUserIds(): Set<number> | null {
  const raw = process.env["TELEGRAM_ALLOWED_USER_IDS"];
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? new Set(ids) : null;
}

/**
 * Start the inbound poller. Idempotent — calling more than once is a no-op.
 * Returns silently if Telegram credentials aren't set, so the bot can run
 * without Telegram entirely.
 */
export function startTelegramAnswerLoop(): void {
  if (started) return;
  if (!isConfigured()) {
    logger.info(
      "Telegram answer loop: not configured (missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID); skipping",
    );
    return;
  }
  if (allowedChatId() === null) {
    logger.warn(
      "Telegram answer loop: TELEGRAM_CHAT_ID is set but not numeric; refusing to start",
    );
    return;
  }
  started = true;
  stopRequested = false;
  void runLoop();
  logger.info("Telegram answer loop: started");
}

export function stopTelegramAnswerLoop(): void {
  stopRequested = true;
}

async function runLoop(): Promise<void> {
  // Drain backlog so we don't reply to a flood of old messages on boot.
  // offset=-1 fetches the most recent update (or none); we record its id
  // so the next poll only sees new messages.
  try {
    const initial = await fetchUpdates({ offset: -1, timeout: 0 });
    const last = initial[initial.length - 1];
    if (last) {
      lastUpdateId = last.update_id;
      logger.info(
        { drained: initial.length, lastUpdateId },
        "Telegram answer loop: drained backlog",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Telegram answer loop: backlog drain failed (continuing)");
  }

  while (!stopRequested) {
    try {
      const updates = await fetchUpdates({
        offset: lastUpdateId + 1,
        timeout: POLL_TIMEOUT_S,
      });
      for (const upd of updates) {
        if (upd.update_id > lastUpdateId) lastUpdateId = upd.update_id;
        await handleUpdate(upd).catch((err) => {
          logger.warn(
            { err, updateId: upd.update_id },
            "Telegram answer loop: handler error",
          );
        });
      }
    } catch (err) {
      logger.warn({ err }, "Telegram answer loop: poll error; backing off");
      await sleep(ERROR_BACKOFF_MS);
    }
  }
  started = false;
  stopRequested = false;
  logger.info("Telegram answer loop: stopped");
}

async function fetchUpdates(opts: {
  offset: number;
  timeout: number;
}): Promise<TelegramUpdate[]> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) return [];
  const allowed = encodeURIComponent('["message"]');
  const url =
    `${TELEGRAM_API}/bot${token}/getUpdates` +
    `?offset=${opts.offset}&timeout=${opts.timeout}&allowed_updates=${allowed}`;
  // Watchdog: long-polling holds the connection open for ~timeout seconds, so
  // give it +10s before we abort. Without this a hung connection would block
  // the loop forever.
  const ctrl = new AbortController();
  const watchdog = setTimeout(() => ctrl.abort(), (opts.timeout + 10) * 1000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Telegram getUpdates ${resp.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await resp.json()) as {
      ok: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    if (!data.ok) {
      throw new Error(`Telegram getUpdates ok=false: ${data.description ?? ""}`);
    }
    return data.result ?? [];
  } finally {
    clearTimeout(watchdog);
  }
}

async function handleUpdate(upd: TelegramUpdate): Promise<void> {
  const msg = upd.message;
  if (!msg || !msg.text) return;

  const allowed = allowedChatId();
  if (allowed === null || msg.chat.id !== allowed) {
    logger.info(
      { chatId: msg.chat.id, expected: allowed },
      "Telegram answer: ignoring message from non-whitelisted chat",
    );
    return;
  }
  // If TELEGRAM_ALLOWED_USER_IDS is set, also gate by sender. Important when
  // the configured chat is a group — without this, any group member could
  // burn OpenAI tokens.
  const userGate = allowedUserIds();
  if (userGate !== null) {
    const senderId = msg.from?.id;
    if (typeof senderId !== "number" || !userGate.has(senderId)) {
      logger.info(
        { senderId, chatId: msg.chat.id },
        "Telegram answer: sender not in TELEGRAM_ALLOWED_USER_IDS",
      );
      return;
    }
  }

  let text = msg.text.trim();
  if (text.length === 0) return;
  if (text.length > MAX_QUESTION_CHARS) text = text.slice(0, MAX_QUESTION_CHARS);

  if (text === "/start" || text === "/help") {
    await sendTelegramText(
      "I'm Ephemeroi. Send me a question and I'll answer it, searching the web when that helps.",
    );
    return;
  }

  // Show a typing indicator so the user knows we heard them. Best-effort —
  // failures are logged but don't block the answer.
  await sendChatAction("typing");

  try {
    const answer = await answerWithWebSearch(text);
    await sendTelegramText(answer);
    logger.info(
      { qPreview: text.slice(0, 120), answerChars: answer.length },
      "Telegram answer: replied",
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    logger.warn({ err, qPreview: text.slice(0, 120) }, "Telegram answer: failed");
    await sendTelegramText(
      `Sorry — I couldn't answer that. (${m.slice(0, 300)})`,
    );
  }
}

async function sendChatAction(action: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return;
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // best effort
  }
}

/**
 * Ask GPT-4o-mini with the OpenAI Responses API web_search tool. The model
 * decides on its own whether the question needs the web (recent events,
 * prices, releases) or whether it can answer from prior knowledge.
 *
 * Response is plain text (no markdown — Telegram's parse modes are picky)
 * and short enough to fit a single Telegram message.
 */
export async function answerWithWebSearch(question: string): Promise<string> {
  const sys = [
    "You are Ephemeroi, an autonomous observer.",
    "Answer the user's question directly and concisely.",
    "Use the web_search tool whenever the answer depends on recent events, current status, prices, news, releases, schedules, or anything that may have changed recently. Skip web search only for stable knowledge or pure reasoning.",
    "When you used the web, cite sources inline as [1], [2] and list them at the end as '1. <title> — <url>'.",
    "Plain text only — no markdown formatting like ** or _. Aim for under 2500 characters total so it fits a single Telegram message.",
    "If neither prior knowledge nor the web yields an answer, say so honestly.",
  ].join(" ");

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    tools: [{ type: "web_search" } as { type: "web_search" }],
    input: `${sys}\n\nUser question:\n${question}`,
  });

  const out = (response.output ?? []) as ResponsesOutputItem[];
  let text = "";
  for (const item of out) {
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.text) text += part.text;
      }
    }
  }
  text = text.trim();
  if (!text) text = "I produced no answer for that question.";
  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
