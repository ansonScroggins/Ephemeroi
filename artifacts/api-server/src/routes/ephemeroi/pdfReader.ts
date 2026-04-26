import { logger } from "../../lib/logger";

const TELEGRAM_API = "https://api.telegram.org";

// Telegram bots can download files up to 20 MB via the file API. We hard-cap
// somewhat below that so we can fail clearly *before* a multi-MB download
// hangs the answer loop. Override with EPHEMEROI_PDF_MAX_BYTES if needed.
const DEFAULT_MAX_PDF_BYTES = 18 * 1024 * 1024;
// Cap the extracted text we feed into the LLM so a giant PDF can't blow
// past the model's context window or burn an unbounded number of tokens.
// 80 K chars is roughly 20 K tokens — leaves plenty of room in gpt-4o-mini's
// 128 K window for the system prompt + the model's reply. Override with
// EPHEMEROI_PDF_MAX_TEXT_CHARS.
const DEFAULT_MAX_PDF_TEXT_CHARS = 80_000;
// Per-fetch timeout for the Telegram getFile + file-download calls. A stalled
// connection without this would block handleUpdate and freeze the long-poll
// loop. 30 s easily covers a worst-case 18 MB download on a slow link.
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Coerce an env override into a finite positive integer, falling back to the
 * default if it's missing/non-numeric/non-positive. Without this guard a
 * typo'd EPHEMEROI_PDF_MAX_BYTES would coerce to NaN and silently disable
 * the comparison, re-opening the unbounded-download / unbounded-tokens DoS
 * surface that the cap exists to close. Logs at warn so misconfiguration is
 * visible at boot.
 */
function envPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      { env: name, value: raw, using: fallback },
      "pdfReader: invalid env override; falling back to default",
    );
    return fallback;
  }
  const intVal = Math.floor(parsed);
  if (intVal > max) {
    logger.warn(
      { env: name, value: raw, max, using: max },
      "pdfReader: env override exceeds hard ceiling; clamping",
    );
    return max;
  }
  return intVal;
}

// Hard ceilings: even if the operator overrides, we never go above these.
// 20 MB = the Telegram bot file API ceiling; 1 M chars ≈ 250 K tokens which
// already exceeds gpt-4o-mini's context comfortably.
const MAX_PDF_BYTES = envPositiveInt(
  "EPHEMEROI_PDF_MAX_BYTES",
  DEFAULT_MAX_PDF_BYTES,
  20 * 1024 * 1024,
);
const MAX_PDF_TEXT_CHARS = envPositiveInt(
  "EPHEMEROI_PDF_MAX_TEXT_CHARS",
  DEFAULT_MAX_PDF_TEXT_CHARS,
  1_000_000,
);

interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path?: string; file_size?: number };
  description?: string;
}

export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfReadError";
  }
}

/**
 * Download a file the user attached in Telegram and extract its text. Throws
 * `PdfReadError` with a user-friendly message on any failure (over-size,
 * download error, parse error) so the caller can relay the reason to the
 * user without leaking internals.
 *
 * Returns the extracted text, possibly truncated to MAX_PDF_TEXT_CHARS with
 * a clear marker so the LLM knows the input was clipped.
 */
export async function downloadAndExtractPdfText(
  fileId: string,
  declaredSize: number | undefined,
): Promise<{ text: string; truncated: boolean; pages: number }> {
  if (typeof declaredSize === "number" && declaredSize > MAX_PDF_BYTES) {
    throw new PdfReadError(
      `PDF is ${(declaredSize / 1024 / 1024).toFixed(1)} MB; the limit is ` +
        `${(MAX_PDF_BYTES / 1024 / 1024).toFixed(0)} MB.`,
    );
  }

  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    // Should be impossible in practice — the answer loop won't even start
    // without TELEGRAM_BOT_TOKEN — but guard anyway so this helper is safe
    // to call from anywhere.
    throw new PdfReadError("Telegram bot is not configured on the server.");
  }

  // 1. getFile → resolve file_path
  const getFileResp = await fetchWithTimeout(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    "looking up the file",
  );
  if (!getFileResp.ok) {
    throw new PdfReadError(
      `Telegram getFile failed with HTTP ${getFileResp.status}.`,
    );
  }
  const meta = (await getFileResp.json().catch(() => ({}))) as TelegramFileResponse;
  if (!meta.ok || !meta.result?.file_path) {
    throw new PdfReadError(
      `Telegram couldn't locate the file (${meta.description ?? "no detail"}).`,
    );
  }
  // Re-check size against the authoritative server-side number, in case the
  // initial declared_size from the message was wrong/missing.
  if (
    typeof meta.result.file_size === "number" &&
    meta.result.file_size > MAX_PDF_BYTES
  ) {
    throw new PdfReadError(
      `PDF is ${(meta.result.file_size / 1024 / 1024).toFixed(1)} MB; the ` +
        `limit is ${(MAX_PDF_BYTES / 1024 / 1024).toFixed(0)} MB.`,
    );
  }

  // 2. Download the bytes
  const downloadUrl = `${TELEGRAM_API}/file/bot${token}/${meta.result.file_path}`;
  const fileResp = await fetchWithTimeout(downloadUrl, "downloading the file");
  if (!fileResp.ok) {
    throw new PdfReadError(
      `Couldn't download the file (HTTP ${fileResp.status}).`,
    );
  }
  const buf = await fileResp.arrayBuffer().catch((err: unknown) => {
    throw new PdfReadError(`Couldn't read the file body (${describeErr(err)}).`);
  });
  if (buf.byteLength > MAX_PDF_BYTES) {
    throw new PdfReadError(
      `PDF is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ` +
        `${(MAX_PDF_BYTES / 1024 / 1024).toFixed(0)} MB.`,
    );
  }
  const bytes = new Uint8Array(buf);

  // 3. Extract text. unpdf's extractText returns { totalPages, text } where
  // text is per-page when mergePages=false, or a single string when true.
  // Lazy-import so this heavy module only loads when someone actually sends
  // a PDF (it pulls pdfjs-dist in).
  let result: { totalPages: number; text: string };
  try {
    const { extractText } = await import("unpdf");
    const out = await extractText(bytes, { mergePages: true });
    result = { totalPages: out.totalPages, text: out.text as unknown as string };
  } catch (err) {
    logger.warn({ err }, "PDF extract failed");
    throw new PdfReadError(
      "I couldn't read this PDF — it may be encrypted, scanned-only, or corrupt.",
    );
  }

  let text = (result.text ?? "").trim();
  if (!text) {
    throw new PdfReadError(
      "This PDF has no extractable text — it's probably image-only (scanned).",
    );
  }
  let truncated = false;
  if (text.length > MAX_PDF_TEXT_CHARS) {
    const omitted = text.length - MAX_PDF_TEXT_CHARS;
    text =
      text.slice(0, MAX_PDF_TEXT_CHARS) +
      `\n\n[…truncated; ${omitted} more characters omitted]`;
    truncated = true;
  }
  return { text, truncated, pages: result.totalPages };
}

/**
 * fetch wrapped in an AbortController-driven timeout. Throws PdfReadError on
 * network failure or timeout so the caller can relay a user-friendly message
 * without leaking the URL (which contains TELEGRAM_BOT_TOKEN).
 */
async function fetchWithTimeout(
  url: string,
  what: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (err: unknown) {
    if ((err as { name?: string } | null)?.name === "AbortError") {
      throw new PdfReadError(
        `Telegram timed out while ${what} (after ${FETCH_TIMEOUT_MS / 1000}s).`,
      );
    }
    throw new PdfReadError(`Network error while ${what} (${describeErr(err)}).`);
  } finally {
    clearTimeout(t);
  }
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
