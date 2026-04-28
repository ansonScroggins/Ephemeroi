import { createHash } from "node:crypto";
import {
  github,
  parseRepoTarget,
  parseUserTarget,
  GitHubError,
  type GhCommit,
  type GhRelease,
  type GhIssue,
} from "../../lib/github-client";
import {
  insertObservationIfNew,
  getSourceCursor,
  updateSourceCursor,
  type SourceRow,
  type ObservationRow,
} from "./store";

interface RepoCursor {
  lastCommitSha?: string;
  lastReleaseId?: number;
  lastIssueUpdatedAt?: string;
}

// Cursor shape for `kind=github` (single repo).
type GithubCursor = RepoCursor;

// Cursor shape for `kind=github_user` (whole-user fanout). Each watched repo
// keeps its own RepoCursor so adding a new repo to a user mid-life starts
// from "now" rather than backfilling years of history.
interface GithubUserCursor {
  repos?: Record<string, RepoCursor>;
  lastUserSync?: string;
}

const COMMIT_PER_PAGE = 30;
const RELEASE_PER_PAGE = 10;
const ISSUE_PER_PAGE = 30;
// Hard cap on pages per source per cycle so a huge backlog can't monopolize
// the loop or rate-limit us. Backlogs beyond this catch up across cycles.
const MAX_PAGES_PER_KIND = 5;

// For a github_user source, cap how many of the user's repos we touch per
// cycle. Sorted by pushed_at desc, so we always cover the active ones first.
// Repos beyond this are simply not watched in v1 (a follow-up could rotate
// the tail across cycles).
const MAX_REPOS_PER_USER = 30;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function firstParagraph(text: string | null | undefined, maxLen = 600): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const para = trimmed.split(/\n\s*\n/)[0] ?? trimmed;
  return para.length > maxLen ? para.slice(0, maxLen) + "…" : para;
}

function commitToObservation(
  source: SourceRow,
  repoLabel: string,
  c: GhCommit,
): Parameters<typeof insertObservationIfNew>[0] {
  const message = c.commit?.message ?? "";
  const subject = (message.split("\n")[0] ?? "").slice(0, 180);
  const author =
    c.author?.login ?? c.commit?.author?.name ?? c.commit?.author?.email ?? "unknown";
  const date = c.commit?.author?.date ?? "";
  const snippet = `${firstParagraph(message)}\n\nAuthor: ${author}${date ? `\nDate: ${date}` : ""}\nCommit: ${c.sha.slice(0, 7)}`;
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title: `[${repoLabel}] commit: ${subject || c.sha.slice(0, 7)}`,
    snippet,
    url: c.html_url,
    urlHash: sha256(c.html_url),
  };
}

function releaseToObservation(
  source: SourceRow,
  repoLabel: string,
  r: GhRelease,
): Parameters<typeof insertObservationIfNew>[0] {
  const title = r.name?.trim() || r.tag_name;
  const author = r.author?.login ?? "unknown";
  const snippet = `${firstParagraph(r.body, 800)}\n\nTag: ${r.tag_name}\nAuthor: ${author}${r.published_at ? `\nPublished: ${r.published_at}` : ""}`;
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title: `[${repoLabel}] release: ${title}`,
    snippet,
    url: r.html_url,
    urlHash: sha256(r.html_url),
  };
}

function issueToObservation(
  source: SourceRow,
  repoLabel: string,
  i: GhIssue,
): Parameters<typeof insertObservationIfNew>[0] {
  const kind = i.pull_request ? "pull-request" : "issue";
  const author = i.user?.login ?? "unknown";
  const snippet = `${firstParagraph(i.body, 700)}\n\nState: ${i.state}\nAuthor: ${author}\nUpdated: ${i.updated_at}`;
  // Use updated_at as part of urlHash so a status change re-ingests once.
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    title: `[${repoLabel}] ${kind} #${i.number}: ${i.title.slice(0, 180)}`,
    snippet,
    url: i.html_url,
    urlHash: sha256(`${i.html_url}#${i.updated_at}`),
  };
}

// Per-repo ingestion. Pulled out of the original ingestGithub() so it can be
// reused by both the single-repo (`kind=github`) source and the whole-user
// (`kind=github_user`) source. Returns the new RepoCursor and observations
// added; mutates nothing externally so the caller decides when to persist.
async function ingestSingleRepo(
  source: SourceRow,
  owner: string,
  repo: string,
  cursor: RepoCursor,
): Promise<{ added: ObservationRow[]; nextCursor: RepoCursor }> {
  const repoLabel = `${owner}/${repo}`;
  const next: RepoCursor = { ...cursor };
  const added: ObservationRow[] = [];

  // --- Commits ---
  // Strategy: GitHub's commits endpoint returns newest-first and supports
  // ?until=ISO_DATE to walk backward. We paginate via `until` (the date of
  // the oldest commit on the previous page) until we either find the cursor
  // SHA, run out of commits, or hit MAX_PAGES_PER_KIND. The cursor is only
  // advanced to the newest commit *after* a clean run so partial failures
  // re-try next cycle.
  const repoMeta = await github.getRepo(owner, repo);
  const commitCollected: GhCommit[] = [];
  let until: string | undefined;
  let commitCursorReached = false;
  for (let page = 0; page < MAX_PAGES_PER_KIND; page++) {
    const batch = await github.listCommits(owner, repo, {
      perPage: COMMIT_PER_PAGE,
      sha: repoMeta.default_branch,
      until,
    });
    if (batch.length === 0) break;
    let stop = false;
    for (const c of batch) {
      if (cursor.lastCommitSha && c.sha === cursor.lastCommitSha) {
        commitCursorReached = true;
        stop = true;
        break;
      }
      commitCollected.push(c);
    }
    if (stop || batch.length < COMMIT_PER_PAGE) break;
    if (!cursor.lastCommitSha) break;
    const oldest = batch[batch.length - 1]!;
    const oldestDate = oldest.commit?.author?.date;
    if (!oldestDate) break;
    until = oldestDate;
  }
  if (cursor.lastCommitSha && !commitCursorReached && commitCollected.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ephemeroi/github] ${repoLabel}: commit backlog > ${MAX_PAGES_PER_KIND * COMMIT_PER_PAGE}, will catch up next cycle`,
    );
  }
  // Insert oldest-first so observations land in chronological order.
  for (const c of [...commitCollected].reverse()) {
    const obs = await insertObservationIfNew(commitToObservation(source, repoLabel, c));
    if (obs) added.push(obs);
  }
  if (commitCollected.length > 0) {
    next.lastCommitSha = commitCollected[0]!.sha;
  }

  // --- Releases ---
  try {
    const collected: GhRelease[] = [];
    let cursorReached = false;
    for (let page = 1; page <= MAX_PAGES_PER_KIND; page++) {
      const batch = await github.listReleases(owner, repo, RELEASE_PER_PAGE, page);
      if (batch.length === 0) break;
      let stop = false;
      for (const r of batch) {
        if (cursor.lastReleaseId && r.id === cursor.lastReleaseId) {
          cursorReached = true;
          stop = true;
          break;
        }
        collected.push(r);
      }
      if (stop || batch.length < RELEASE_PER_PAGE) break;
      if (!cursor.lastReleaseId) break;
    }
    if (cursor.lastReleaseId && !cursorReached && collected.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ephemeroi/github] ${repoLabel}: release backlog > ${MAX_PAGES_PER_KIND * RELEASE_PER_PAGE}, will catch up next cycle`,
      );
    }
    for (const r of [...collected].reverse()) {
      const obs = await insertObservationIfNew(releaseToObservation(source, repoLabel, r));
      if (obs) added.push(obs);
    }
    if (collected.length > 0) {
      next.lastReleaseId = collected[0]!.id;
    }
  } catch (err) {
    // Releases endpoint can 404 on bare repos — non-fatal.
    if (!(err instanceof GitHubError && err.status === 404)) {
      throw err;
    }
  }

  // --- Issues (open + closed, "since" filter, ascending so paging is safe) ---
  try {
    let maxUpdated = cursor.lastIssueUpdatedAt ?? "";
    for (let page = 1; page <= MAX_PAGES_PER_KIND; page++) {
      const batch = await github.listIssues(owner, repo, {
        since: cursor.lastIssueUpdatedAt,
        perPage: ISSUE_PER_PAGE,
        direction: "asc",
        page,
      });
      if (batch.length === 0) break;
      for (const i of batch) {
        const obs = await insertObservationIfNew(issueToObservation(source, repoLabel, i));
        if (obs) added.push(obs);
        if (i.updated_at > maxUpdated) maxUpdated = i.updated_at;
      }
      if (batch.length < ISSUE_PER_PAGE) break;
      if (!cursor.lastIssueUpdatedAt) break;
      if (page === MAX_PAGES_PER_KIND) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ephemeroi/github] ${repoLabel}: issue backlog > ${MAX_PAGES_PER_KIND * ISSUE_PER_PAGE}, will catch up next cycle`,
        );
      }
    }
    if (maxUpdated) next.lastIssueUpdatedAt = maxUpdated;
  } catch (err) {
    if (!(err instanceof GitHubError && err.status === 404)) {
      throw err;
    }
  }

  return { added, nextCursor: next };
}

export async function ingestGithub(
  source: SourceRow,
): Promise<{ added: ObservationRow[] }> {
  const parsed = parseRepoTarget(source.target);
  if (!parsed) {
    throw new Error(`Invalid github target: ${source.target}`);
  }
  const { owner, repo, canonical } = parsed;
  const cursor = ((await getSourceCursor(source.id)) as GithubCursor | null) ?? {};
  try {
    const { added, nextCursor } = await ingestSingleRepo(source, owner, repo, cursor);
    await updateSourceCursor(source.id, nextCursor as Record<string, unknown>);
    return { added };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      throw new Error(`Repository not found: ${canonical}`);
    }
    throw err;
  }
}

// Whole-user ingestion. Lists the user's owned public repos (capped) and
// runs the per-repo ingestion against each, accumulating per-repo cursors
// inside the source's `cursor.repos` map. Per-repo failures are logged and
// skipped so a single bad repo doesn't poison the whole cycle.
export async function ingestGithubUser(
  source: SourceRow,
): Promise<{ added: ObservationRow[] }> {
  const parsed = parseUserTarget(source.target);
  if (!parsed) {
    throw new Error(`Invalid github user target: ${source.target}`);
  }
  const { user } = parsed;

  const rawCursor = (await getSourceCursor(source.id)) as GithubUserCursor | null;
  const cursor: GithubUserCursor = rawCursor ?? {};
  const repoCursors: Record<string, RepoCursor> = { ...(cursor.repos ?? {}) };

  // Page through until we have MAX_REPOS_PER_USER eligible repos OR we run
  // out of pages. Filter (no private/fork/archived/disabled) is applied
  // BEFORE the slice so a user whose top 100 repos are mostly forks still
  // gets MAX_REPOS_PER_USER actual original public ones — provided they
  // exist within MAX_USER_REPO_PAGES * 100 most-recently-pushed total.
  const MAX_USER_REPO_PAGES = 5;
  const candidates: Array<{ full_name: string }> = [];
  try {
    for (let page = 1; page <= MAX_USER_REPO_PAGES; page++) {
      const batch = await github.listUserRepos(user, { perPage: 100, page });
      if (batch.length === 0) break;
      for (const r of batch) {
        if (r.private || r.fork || r.archived || r.disabled) continue;
        candidates.push({ full_name: r.full_name });
        if (candidates.length >= MAX_REPOS_PER_USER) break;
      }
      if (candidates.length >= MAX_REPOS_PER_USER) break;
      if (batch.length < 100) break;
    }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      throw new Error(`GitHub user not found: ${user}`);
    }
    throw err;
  }

  if (candidates.length === 0) {
    // Nothing to watch; record a sync timestamp anyway so the UI shows the
    // user as polled rather than perpetually "Never".
    await updateSourceCursor(source.id, {
      ...cursor,
      repos: repoCursors,
      lastUserSync: new Date().toISOString(),
    } as Record<string, unknown>);
    return { added: [] };
  }

  const aggregated: ObservationRow[] = [];
  const failures: string[] = [];
  for (const r of candidates) {
    const [owner, repo] = r.full_name.split("/");
    if (!owner || !repo) continue;
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const subCursor = repoCursors[key] ?? {};
    try {
      const { added, nextCursor } = await ingestSingleRepo(source, owner.toLowerCase(), repo.toLowerCase(), subCursor);
      repoCursors[key] = nextCursor;
      aggregated.push(...added);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${key}: ${msg}`);
      // eslint-disable-next-line no-console
      console.warn(`[ephemeroi/github_user] ${user} → ${key} failed: ${msg}`);
    }
  }

  await updateSourceCursor(source.id, {
    ...cursor,
    repos: repoCursors,
    lastUserSync: new Date().toISOString(),
  } as Record<string, unknown>);

  // If EVERY repo failed, surface that to the caller so the source row gets
  // marked with an error in the UI. Partial failures are silently logged
  // (above) and the cycle is otherwise considered successful.
  if (failures.length === candidates.length && failures.length > 0) {
    throw new Error(`All ${failures.length} repos failed: ${failures[0]}`);
  }

  return { added: aggregated };
}
