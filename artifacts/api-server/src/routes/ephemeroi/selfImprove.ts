import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import { sendTelegramText, isTelegramConfigured } from "./telegram";

/**
 * Files Ephemeroi is allowed to edit during a self-improvement run. Bounded
 * to its own routes folder so the blast radius is the bot's own brain — not
 * the rest of the codebase. Paths are relative to process.cwd(), which the
 * api-server's pnpm-filtered dev script sets to artifacts/api-server.
 */
const IMPROVABLE_FILES = [
  "src/routes/ephemeroi/loop.ts",
  "src/routes/ephemeroi/reflect.ts",
  "src/routes/ephemeroi/store.ts",
  "src/routes/ephemeroi/discover.ts",
  "src/routes/ephemeroi/constellation.ts",
  "src/routes/ephemeroi/don.ts",
  "src/routes/ephemeroi/ingest.ts",
  "src/routes/ephemeroi/ingest-github.ts",
  "src/routes/ephemeroi/guard.ts",
  "src/routes/ephemeroi/telegram.ts",
] as const;

const ImprovementSchema = z.object({
  file: z.string(),
  oldString: z.string().min(8),
  newString: z.string(),
  rationale: z.string().min(8),
});

export interface SelfImprovementResult {
  applied: boolean;
  file: string | null;
  rationale: string | null;
  diffPreview: string | null;
  buildOk: boolean | null;
  error: string | null;
}

/** Module-scoped guard so two simultaneous triggers can't fight over the same dist. */
let inFlight = false;

export class SelfImproveInFlightError extends Error {
  constructor() {
    super("Self-improvement already in flight");
    this.name = "SelfImproveInFlightError";
  }
}

/**
 * The complete self-improvement loop:
 *   1. Read every whitelisted source file.
 *   2. Ask GPT for ONE focused, substantive patch (JSON: file/oldString/newString/rationale).
 *   3. Validate: file in whitelist, oldString unique, patch is not a no-op.
 *   4. Write the patched file.
 *   5. Run the api-server's own bundler (`node ./build.mjs`) to verify it compiles.
 *      On failure, restore the original and report the build error.
 *   6. On success, ping Telegram with the rationale + a small diff preview.
 *      The change won't take effect until the api-server process is restarted —
 *      we tell the user that explicitly.
 *
 * Never throws (other than InFlightError) — every failure mode resolves to a
 * structured result so the HTTP route can render it cleanly.
 */
export async function runSelfImprovement(): Promise<SelfImprovementResult> {
  if (inFlight) throw new SelfImproveInFlightError();
  inFlight = true;
  try {
    return await runSelfImprovementInner();
  } finally {
    inFlight = false;
  }
}

async function runSelfImprovementInner(): Promise<SelfImprovementResult> {
  const cwd = process.cwd();

  // 1. Read whitelisted source files.
  const fileContents: Record<string, string> = {};
  for (const rel of IMPROVABLE_FILES) {
    try {
      const abs = path.resolve(cwd, rel);
      fileContents[rel] = await fs.readFile(abs, "utf8");
    } catch (err) {
      logger.warn({ err, rel }, "Self-improvement: file unreadable");
    }
  }
  if (Object.keys(fileContents).length === 0) {
    return result(false, null, null, null, null, "No source files readable");
  }

  // 2. Ask the LLM for one focused improvement.
  const filesPrompt = Object.entries(fileContents)
    .map(([f, c]) => `### ${f}\n\`\`\`ts\n${c}\n\`\`\``)
    .join("\n\n");

  const sys = [
    "You are Ephemeroi's self-improvement function. You read your own source code and propose ONE focused, substantive improvement.",
    "Acceptable improvements: a real bug fix, a missing edge case (null/empty/error path), a typo or off-by-one, a clearer error message, a small performance or clarity win, a tightened type, or a better safety check.",
    "DO NOT propose trivial cosmetic-only changes: do not reorder imports, reflow whitespace, rename variables for taste, or add comments without substance.",
    "DO NOT change exported function signatures (other modules import them).",
    "Output ONLY a single JSON object with exactly these keys:",
    '- "file": one of the file paths shown',
    '- "oldString": the EXACT contiguous block of text to replace; include 3-6 lines of surrounding context so it appears EXACTLY ONCE in the file',
    '- "newString": the replacement (same shape as oldString, with your edit)',
    '- "rationale": ONE sentence describing what changed and why',
    "Do not output markdown fences. Do not output multiple objects. Do not include any prose outside the JSON.",
  ].join("\n");

  let parsed: z.infer<typeof ImprovementSchema>;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Here are my source files. Propose ONE improvement now.\n\n${filesPrompt}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.4,
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    parsed = ImprovementSchema.parse(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Self-improvement: LLM proposal failed");
    await notify(`⚙️ Ephemeroi self-improvement aborted: LLM proposal invalid (${msg.slice(0, 200)})`);
    return result(false, null, null, null, null, `LLM proposal failed: ${msg}`);
  }

  // 3. Validate the patch.
  if (!IMPROVABLE_FILES.includes(parsed.file as (typeof IMPROVABLE_FILES)[number])) {
    const err = `File not in whitelist: ${parsed.file}`;
    await notify(`⚙️ Ephemeroi self-improvement aborted: ${err}`);
    return result(false, parsed.file, parsed.rationale, null, null, err);
  }
  const original = fileContents[parsed.file];
  if (typeof original !== "string") {
    const err = `File contents missing for ${parsed.file}`;
    await notify(`⚙️ Ephemeroi self-improvement aborted: ${err}`);
    return result(false, parsed.file, parsed.rationale, null, null, err);
  }
  const occurrences = countOccurrences(original, parsed.oldString);
  if (occurrences === 0) {
    const err = "oldString not found in file (LLM hallucinated context)";
    await notify(`⚙️ Ephemeroi self-improvement aborted: ${err}\nFile: ${parsed.file}`);
    return result(false, parsed.file, parsed.rationale, null, null, err);
  }
  if (occurrences > 1) {
    const err = `oldString appears ${occurrences}× — not unique, would be ambiguous`;
    await notify(`⚙️ Ephemeroi self-improvement aborted: ${err}\nFile: ${parsed.file}`);
    return result(false, parsed.file, parsed.rationale, null, null, err);
  }
  if (parsed.oldString === parsed.newString) {
    const err = "Patch is a no-op (oldString === newString)";
    return result(false, parsed.file, parsed.rationale, null, null, err);
  }

  // 4. Apply the patch.
  const next = original.replace(parsed.oldString, parsed.newString);
  const abs = path.resolve(cwd, parsed.file);
  try {
    await fs.writeFile(abs, next, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, file: parsed.file }, "Self-improvement: write failed");
    await notify(`⚙️ Ephemeroi self-improvement aborted: write failed on ${parsed.file}: ${msg}`);
    return result(false, parsed.file, parsed.rationale, null, null, `write failed: ${msg}`);
  }

  // 5. Verify the patched code still compiles. esbuild is the same bundler the
  //    dev workflow uses, so this exercises the exact path that next start will
  //    take. If it fails, restore the original and rebuild so dist/ isn't left
  //    half-wiped (build.mjs deletes dist/ before bundling, so a failed build
  //    leaves the on-disk bundle missing — a subsequent restart would crash).
  const build = await runBuild();
  if (!build.ok) {
    let recovered = false;
    try {
      await fs.writeFile(abs, original, "utf8");
      const recovery = await runBuild();
      recovered = recovery.ok;
      if (!recovery.ok) {
        logger.error(
          { file: parsed.file, recoveryStderr: recovery.stderr.slice(-400) },
          "Self-improvement: recovery build failed — dist may be in a broken state",
        );
      }
    } catch (restoreErr) {
      logger.error(
        { err: restoreErr, file: parsed.file },
        "Self-improvement: restore after failed build also failed",
      );
    }
    const tail = (build.stderr || build.stdout).slice(-800).trim();
    logger.warn({ buildErr: tail, file: parsed.file, recovered }, "Self-improvement: build failed");
    const recoveryNote = recovered
      ? "Original source + bundle restored — safe to restart."
      : "WARNING: recovery build also failed — running process is fine but a restart may break. Check api-server logs.";
    await notify(
      `⚙️ Ephemeroi self-improvement reverted — build failed.\n\nFile: ${parsed.file}\nRationale: ${parsed.rationale}\n\n${recoveryNote}\n\nBuild error tail:\n${tail}`,
    );
    return result(false, parsed.file, parsed.rationale, null, false, "Build failed; reverted");
  }

  // 6. Success.
  const diffPreview = makeDiffPreview(parsed.oldString, parsed.newString);
  await notify(
    `⚙️ Ephemeroi self-improvement applied\n\nFile: ${parsed.file}\nRationale: ${parsed.rationale}\n\nDiff:\n${diffPreview}\n\n(Restart api-server to load the new code.)`,
  );
  logger.info(
    { file: parsed.file, rationale: parsed.rationale },
    "Self-improvement applied",
  );
  return result(true, parsed.file, parsed.rationale, diffPreview, true, null);
}

function result(
  applied: boolean,
  file: string | null,
  rationale: string | null,
  diffPreview: string | null,
  buildOk: boolean | null,
  error: string | null,
): SelfImprovementResult {
  return { applied, file, rationale, diffPreview, buildOk, error };
}

async function notify(text: string): Promise<void> {
  if (!isTelegramConfigured()) {
    logger.info({ text }, "Self-improvement notice (Telegram not configured)");
    return;
  }
  await sendTelegramText(text);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) return count;
    count += 1;
    idx = found + needle.length;
  }
}

function makeDiffPreview(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n").slice(0, 8);
  const newLines = newStr.split("\n").slice(0, 8);
  const oldOut = oldLines.map((l) => `- ${l}`).join("\n");
  const newOut = newLines.map((l) => `+ ${l}`).join("\n");
  return `${oldOut}\n${newOut}`;
}

interface BuildResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run the api-server's own bundler in a child process to verify the patched
 * source compiles. The bundler is fast (~250ms) and exercises the exact path
 * the next process start will take. The current running process is unaffected
 * because Node has its modules in memory; only the on-disk dist is rewritten.
 *
 * Hard 60s timeout: if esbuild hangs, the child is SIGKILL'd so it can't pin
 * the module-scoped `inFlight` flag and lock out future self-improvements.
 */
const BUILD_TIMEOUT_MS = 60_000;

function runBuild(): Promise<BuildResult> {
  return new Promise((resolve) => {
    const child = spawn("node", ["./build.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: BuildResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish({
        ok: false,
        stdout,
        stderr: `${stderr}\nbuild killed after ${BUILD_TIMEOUT_MS}ms timeout`,
      });
    }, BUILD_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      finish({ ok: false, stdout, stderr: `${stderr}\nspawn error: ${String(err)}` });
    });
    child.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
  });
}
