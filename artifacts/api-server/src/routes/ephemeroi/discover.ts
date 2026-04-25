import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../../lib/logger";
import {
  countAutoAddedSources,
  createSource,
  listSources,
  type ObservationRow,
  type SourceKind,
  type SourceRow,
} from "./store";

const DISCOVERY_MODEL =
  process.env["EPHEMEROI_DISCOVERY_MODEL"] ?? "gpt-4o-mini";

const MAX_AUTO_ADDS_PER_CYCLE = 2;
const MAX_CANDIDATES_TO_LLM = 10;

export interface DiscoveryResult {
  added: Array<{
    kind: SourceKind;
    target: string;
    reason: string;
  }>;
  considered: number;
  skipped: { reason: string; count: number }[];
}

interface RawCandidate {
  kind: "github" | "github_user";
  target: string;
  /** Where we first saw this reference (for attribution in the LLM prompt). */
  excerpt: string;
}
interface Candidate extends RawCandidate {
  /** How many sources we already watch under this owner. >0 means similar
   *  territory — a strong signal to the LLM that this would be lateral, not
   *  deeper. */
  alreadyWatchedFromOwner: number;
}

/**
 * Scan recent observations for GitHub references and let the LLM decide
 * whether any are worth adding as a new source. Returns what was added so
 * the caller can publish the audit trail.
 *
 * Hard guards (defensive — keeps the bot from running away even if the
 * LLM goes wild):
 *   - Cap of MAX_AUTO_ADDS_PER_CYCLE per cycle.
 *   - Total auto-added sources capped by settings.autonomyMaxSources.
 *   - Candidates already present in the source list (case-insensitive) are
 *     filtered before they ever reach the LLM.
 *   - Targets are validated against strict GitHub-name regexes; anything
 *     that doesn't pass is dropped.
 */
export async function runDiscovery(input: {
  observations: ObservationRow[];
  beliefs: Array<{ id: number; proposition: string; confidence: number }>;
  /** Open (unresolved) contradictions; surfaced to the LLM as "questions
   *  Ephemeroi is currently grappling with" so it can pick sources that
   *  might resolve them — this is what makes discovery feel like learning
   *  one thing at a time rather than just adding peers. */
  openQuestions: string[];
  autonomyMaxSources: number;
}): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    added: [],
    considered: 0,
    skipped: [],
  };

  const totalAuto = await countAutoAddedSources();
  const remainingTotalCap = input.autonomyMaxSources - totalAuto;
  if (remainingTotalCap <= 0) {
    result.skipped.push({ reason: "total cap reached", count: 1 });
    return result;
  }
  const perCycleCap = Math.min(MAX_AUTO_ADDS_PER_CYCLE, remainingTotalCap);

  // 1. Extract GitHub references from observation titles+snippets.
  const rawCandidates = extractGithubReferences(input.observations);

  // 2. Drop any already watched (case-insensitive) and any malformed.
  //    Also build an owner-count map so the LLM can see when a candidate
  //    sits in a topic neighborhood we already cover.
  const allSources = await listSources();
  const watched = new Set(
    allSources.map((s) => `${s.kind}:${s.target.toLowerCase()}`),
  );
  const ownerCounts = new Map<string, number>();
  for (const s of allSources) {
    const owner =
      s.kind === "github" ? s.target.split("/")[0]?.toLowerCase() : s.kind === "github_user" ? s.target.toLowerCase() : null;
    if (!owner) continue;
    ownerCounts.set(owner, (ownerCounts.get(owner) ?? 0) + 1);
  }
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of rawCandidates) {
    const key = `${c.kind}:${c.target.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (watched.has(key)) continue;
    seen.add(key);
    const owner =
      c.kind === "github"
        ? c.target.split("/")[0]?.toLowerCase() ?? ""
        : c.target.toLowerCase();
    candidates.push({
      ...c,
      alreadyWatchedFromOwner: ownerCounts.get(owner) ?? 0,
    });
  }
  result.considered = candidates.length;
  if (candidates.length === 0) return result;

  // Cap how many we send to the LLM; in practice 10 is plenty.
  const sample = candidates.slice(0, MAX_CANDIDATES_TO_LLM);

  // 3. Build "frontier" context for the LLM — what we already watch (so it
  //    doesn't pile on lateral picks) and what questions are still open
  //    (so it picks targets that go DEEPER instead of repeating).
  const watchedSummary = allSources
    .slice(0, 30)
    .map((s) => {
      const tag = s.autoAdded ? " (auto)" : "";
      return `  - ${s.kind}: ${s.target}${tag}`;
    })
    .join("\n");

  // 4. Ask the LLM which (if any) are worth following.
  let picks: Array<{ index: number; reason: string }>;
  try {
    picks = await askLlmWhichToWatch({
      candidates: sample,
      beliefs: input.beliefs,
      openQuestions: input.openQuestions,
      watchedSummary: watchedSummary || "(none yet)",
      maxPicks: perCycleCap,
    });
  } catch (err) {
    logger.warn({ err }, "Discovery LLM failed; skipping autonomy this cycle");
    return result;
  }

  // 4. Add the picks (re-checking the per-cycle and total caps as we go,
  //    in case the LLM returned more than asked).
  for (const pick of picks) {
    if (result.added.length >= perCycleCap) break;
    const cand = sample[pick.index];
    if (!cand) continue;
    try {
      const created = await createSource({
        kind: cand.kind,
        target: cand.target,
        autoAdded: true,
        autoAddedReason: pick.reason.slice(0, 280),
      });
      // createSource is idempotent; if a parallel cycle already inserted
      // the same target the row won't be marked autoAdded. We can detect
      // that by checking the autoAdded flag on the returned row.
      if (created.autoAdded) {
        result.added.push({
          kind: cand.kind,
          target: cand.target,
          reason: pick.reason.slice(0, 280),
        });
      }
    } catch (err) {
      logger.warn(
        { err, candidate: cand },
        "Discovery: failed to create auto source",
      );
    }
  }

  return result;
}

// ----- regex extraction -----

// Bare repo: 1-39 char owner (alnum or single-hyphen), slash, 1-100 char repo.
// We deliberately require the leading boundary to be a non-`.` non-`/` char
// so we don't match middle-of-path tokens like `foo/bar/baz`.
const REPO_RE =
  /(?:^|[\s\(\[<"'`,])([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,99})(?=$|[\s\)\]>"'`,.])/g;
const URL_REPO_RE =
  /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,99})(?:\.git)?(?:[\/#?][^\s]*)?/g;
const URL_USER_RE =
  /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{0,38})(?:\/?$|\/?(?=[\s\)\]>"'`,]))/g;

// Common false positives that look like owner/repo but are something else.
// Includes English words that frequently appear with a slash in prose
// (e.g. "days/weeks", "before/after"), path components, and HTTP scheme
// pieces that survive a torn URL split.
const FALSE_POSITIVE_OWNERS = new Set([
  // URL pieces
  "http",
  "https",
  "www",
  "github.com",
  // Path-y tokens
  "src",
  "lib",
  "dist",
  "node_modules",
  "test",
  "tests",
  "docs",
  "doc",
  "api",
  "v1",
  "v2",
  "v3",
  "blob",
  "tree",
  "commit",
  "commits",
  "issues",
  "pull",
  "pulls",
  "compare",
  "raw",
  "wiki",
  "releases",
  "actions",
  // Prose word/word patterns
  "and",
  "or",
  "as",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "without",
  "about",
  "before",
  "after",
  "during",
  "above",
  "below",
  "yes",
  "no",
  "true",
  "false",
  "this",
  "that",
  "these",
  "those",
  "his",
  "her",
  "their",
  "its",
  "our",
  "your",
  "my",
  "is",
  "was",
  "are",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "done",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "pros",
  "cons",
  "yes",
  "either",
  "neither",
  "both",
  "all",
  "some",
  "any",
  "none",
  "many",
  "few",
  "most",
  "least",
  "more",
  "less",
  "much",
  "little",
  "bigger",
  "smaller",
  // Time prose
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "decade",
  "decades",
  "today",
  "yesterday",
  "tomorrow",
  // Other prose
  "input",
  "output",
  "key",
  "value",
  "name",
  "type",
  "kind",
  "id",
  "url",
  "uri",
  "path",
  "file",
  "dir",
  "folder",
  "page",
  "pages",
  "code",
  "data",
  "log",
  "logs",
  "user",
  "users",
  "owner",
  "repo",
  "repos",
  "branch",
  "branches",
  "tag",
  "tags",
]);
// Reserved GitHub paths that are NOT user/org names.
const RESERVED_USERS = new Set([
  "about",
  "blog",
  "contact",
  "explore",
  "features",
  "issues",
  "login",
  "logout",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "topics",
  "trending",
]);

function extractGithubReferences(observations: ObservationRow[]): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const obs of observations) {
    const text = `${obs.title} ${obs.snippet}`;

    // URL form first — most specific.
    for (const m of text.matchAll(URL_REPO_RE)) {
      const owner = m[1]!.toLowerCase();
      const repo = stripSuffix(m[2]!.toLowerCase(), ".git");
      if (FALSE_POSITIVE_OWNERS.has(owner)) continue;
      out.push({
        kind: "github",
        target: `${owner}/${repo}`,
        excerpt: snippetAround(text, m.index ?? 0),
      });
    }

    // User-only URL form (no /repo segment).
    for (const m of text.matchAll(URL_USER_RE)) {
      const user = m[1]!.toLowerCase();
      if (RESERVED_USERS.has(user)) continue;
      // Don't double-emit if a more-specific repo URL was matched in the
      // same span: skip if the same span overlaps an earlier repo match.
      out.push({
        kind: "github_user",
        target: user,
        excerpt: snippetAround(text, m.index ?? 0),
      });
    }

    // Bare owner/repo form (without the github.com/ prefix). Only accept
    // when the word "github" appears within a 120-char window of the match
    // — that guards against prose like "days/weeks" or "pros/cons" which
    // would otherwise pass the lexical owner/repo regex.
    const lowerText = text.toLowerCase();
    for (const m of text.matchAll(REPO_RE)) {
      const owner = m[1]!.toLowerCase();
      // The repo segment can greedily eat trailing `.git` or sentence-end
      // punctuation. Clean those off rather than dropping the candidate.
      const repo = trimRepoSuffix(m[2]!.toLowerCase());
      if (!repo) continue;
      if (FALSE_POSITIVE_OWNERS.has(owner)) continue;
      if (FALSE_POSITIVE_OWNERS.has(repo)) continue;
      // owner can't end in `-`
      if (owner.endsWith("-")) continue;
      const idx = m.index ?? 0;
      const windowStart = Math.max(0, idx - 120);
      const windowEnd = Math.min(lowerText.length, idx + (m[0]?.length ?? 0) + 120);
      const window = lowerText.slice(windowStart, windowEnd);
      if (!window.includes("github")) continue;
      out.push({
        kind: "github",
        target: `${owner}/${repo}`,
        excerpt: snippetAround(text, idx),
      });
    }
  }
  return out;
}

function snippetAround(text: string, idx: number): string {
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + 100);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
}

/**
 * The repo regex character class allows `.`, `_`, `-` so it greedily eats
 * trailing `.git`, `.`, `,`, `)`, etc. when references appear at the end
 * of a sentence or in markdown. Strip those before validating so we keep
 * legitimate references that just happened to be sentence-final.
 */
function trimRepoSuffix(repo: string): string {
  let r = repo;
  // Strip .git first (canonical clone-URL form).
  if (r.endsWith(".git")) r = r.slice(0, -4);
  // Then strip any trailing prose punctuation that snuck into the capture.
  r = r.replace(/[.,;:!?\)\]\>"'`]+$/g, "");
  // After trimming, must still start with an alnum and have at least 1 char.
  if (r.length === 0) return "";
  if (!/^[a-zA-Z0-9]/.test(r)) return "";
  return r;
}

// ----- LLM judgement -----

async function askLlmWhichToWatch(input: {
  candidates: Candidate[];
  beliefs: Array<{ id: number; proposition: string; confidence: number }>;
  openQuestions: string[];
  watchedSummary: string;
  maxPicks: number;
}): Promise<Array<{ index: number; reason: string }>> {
  const { candidates, beliefs, openQuestions, watchedSummary, maxPicks } = input;
  // Show the LLM both the most-confident beliefs (the "settled" parts of
  // its worldview) and the least-confident / freshest beliefs (the
  // "frontier" — where it's still figuring things out). Picking sources
  // that target the frontier is what makes discovery feel like progressive
  // learning instead of lateral collection.
  const sortedByConfidence = [...beliefs].sort(
    (a, b) => Math.abs(b.confidence) - Math.abs(a.confidence),
  );
  const settled = sortedByConfidence.slice(0, 8);
  const frontier = sortedByConfidence.slice(-6).reverse();
  const settledBlock =
    settled.length === 0
      ? "  (none yet — Ephemeroi is still forming a worldview)"
      : settled
          .map((b) => `  - (conf ${b.confidence.toFixed(2)}) ${b.proposition}`)
          .join("\n");
  const frontierBlock =
    frontier.length === 0
      ? "  (nothing tentative yet)"
      : frontier
          .map((b) => `  - (conf ${b.confidence.toFixed(2)}) ${b.proposition}`)
          .join("\n");
  const questionsBlock =
    openQuestions.length === 0
      ? "  (none right now)"
      : openQuestions
          .slice(0, 6)
          .map((q) => `  - ${q}`)
          .join("\n");

  const candidatesBlock = candidates
    .map((c, i) => {
      const overlap =
        c.alreadyWatchedFromOwner > 0
          ? `\n      NOTE: you already watch ${c.alreadyWatchedFromOwner} source(s) from this owner — adding this is LATERAL, not deeper.`
          : "";
      return `  [${i}] kind=${c.kind} target=${c.target}\n      seen near: "${c.excerpt}"${overlap}`;
    })
    .join("\n");

  const system = `You are Ephemeroi, an autonomous explorer that learns one thing at a time — like a curious child building up understanding step by step. After reflecting on a batch of observations you may add a small number of new GitHub sources to your watch list, but only when doing so will DEEPEN your understanding, not duplicate it.

GOOD reasons to add a source (pick at most ${maxPicks}):
- It would help RESOLVE one of your open questions / contradictions.
- It would let you go DEEPER on a tentative belief at the frontier (something you currently rate with low confidence).
- It opens a NEW sub-question that follows naturally from what you just learned, taking you into adjacent territory you don't yet cover.

REJECT a candidate if ANY of these are true:
- The "target" looks like ordinary English prose with a slash (e.g. "days/weeks", "pros/cons", "before/after", "input/output") rather than a real GitHub project name.
- The "seen near" excerpt does not actually describe the candidate as a GitHub project (it just happens to contain a slash).
- You're not confident the project even exists on GitHub.
- It would just confirm something you ALREADY believe with high confidence (no new learning).
- It is too similar to sources you already watch — especially if you already watch sources from the same owner (NOTE flag on the candidate). Lateral additions are NOT what we want; each addition should push into NEW territory or DEEPER on an open question.

If nothing meets the bar, return zero picks. Returning zero is correct most of the time. It is far better to add nothing than to grow a redundant watch list.

Each pick's "reason" MUST start with one of: "Resolves:", "Deepens:", or "Opens:" followed by the specific question, belief, or new direction it advances. Generic reasons like "looks interesting" are NOT acceptable.

Respond with strict JSON of shape:
{"picks": [{"index": <integer index from the list>, "reason": "<Resolves:|Deepens:|Opens: <one short sentence>>"}]}

Do not invent candidates. Only return indices that exist in the list.`;

  const user = `What you already watch (don't pile on the same owners):
${watchedSummary}

Settled parts of your worldview (high confidence — adding sources here is REDUNDANT):
${settledBlock}

Frontier of your worldview (low-confidence beliefs — sources that DEEPEN these are valuable):
${frontierBlock}

Open questions / unresolved contradictions you are grappling with (sources that RESOLVE these are most valuable):
${questionsBlock}

Candidate GitHub sources you noticed in recent observations:
${candidatesBlock}

Decide which (if any) to start watching. Each pick must DEEPEN, RESOLVE, or OPEN something specific. Strict JSON only.`;

  const resp = await openai.chat.completions.create({
    model: DISCOVERY_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = resp.choices[0]?.message?.content?.trim() ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 300) }, "Discovery returned non-JSON");
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const picksRaw = (parsed as Record<string, unknown>)["picks"];
  if (!Array.isArray(picksRaw)) return [];

  const out: Array<{ index: number; reason: string }> = [];
  for (const p of picksRaw.slice(0, maxPicks)) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const idx = Number(o["index"]);
    const reason =
      typeof o["reason"] === "string" ? o["reason"].trim() : "";
    if (!Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= candidates.length) continue;
    if (!reason) continue;
    out.push({ index: idx, reason });
  }
  return out;
}

// Re-export so callers can construct narrow candidate types if needed.
export type { Candidate, SourceRow };
