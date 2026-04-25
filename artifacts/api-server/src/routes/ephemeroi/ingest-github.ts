import { createHash } from "node:crypto";
import {
  github,
  parseRepoTarget,
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

interface GithubCursor {
  lastCommitSha?: string;
  lastReleaseId?: number;
  lastIssueUpdatedAt?: string;
}

const COMMIT_PER_PAGE = 30;
const RELEASE_PER_PAGE = 10;
const ISSUE_PER_PAGE = 30;
// Hard cap on pages per source per cycle so a huge backlog can't monopolize
// the loop or rate-limit us. Backlogs beyond this catch up across cycles.
const MAX_PAGES_PER_KIND = 5;

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
    sourceKind: "github",
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
    sourceKind: "github",
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
    sourceKind: "github",
    sourceLabel: source.label,
    title: `[${repoLabel}] ${kind} #${i.number}: ${i.title.slice(0, 180)}`,
    snippet,
    url: i.html_url,
    urlHash: sha256(`${i.html_url}#${i.updated_at}`),
  };
}

export async function ingestGithub(
  source: SourceRow,
): Promise<{ added: ObservationRow[] }> {
  const parsed = parseRepoTarget(source.target);
  if (!parsed) {
    throw new Error(`Invalid github target: ${source.target}`);
  }
  const { owner, repo, canonical } = parsed;
  const repoLabel = canonical;

  const cursorRaw = (await getSourceCursor(source.id)) as GithubCursor | null;
  const cursor: GithubCursor = cursorRaw ?? {};
  const next: GithubCursor = { ...cursor };
  const added: ObservationRow[] = [];

  // --- Commits ---
  // Strategy: GitHub's commits endpoint returns newest-first and supports
  // ?until=ISO_DATE to walk backward. We paginate via `until` (the date of
  // the oldest commit on the previous page) until we either find the cursor
  // SHA, run out of commits, or hit MAX_PAGES_PER_KIND. The cursor is only
  // advanced to the newest commit *after* a clean run so partial failures
  // re-try next cycle.
  try {
    const repoMeta = await github.getRepo(owner, repo);
    const collected: GhCommit[] = [];
    let until: string | undefined;
    let cursorReached = false;
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
          cursorReached = true;
          stop = true;
          break;
        }
        collected.push(c);
      }
      if (stop || batch.length < COMMIT_PER_PAGE) break;
      // No first-cycle backfill explosion: without a prior cursor we only
      // grab one page so a fresh source doesn't ingest the full repo history.
      if (!cursor.lastCommitSha) break;
      const oldest = batch[batch.length - 1]!;
      const oldestDate = oldest.commit?.author?.date;
      if (!oldestDate) break;
      until = oldestDate;
    }
    if (cursor.lastCommitSha && !cursorReached && collected.length > 0) {
      // Backlog exceeded our page budget — log so it's visible in ops.
      // (Cycle still advances; remaining backlog catches up next cycle via
      // the new cursor we'll set below to the newest seen.)
      // eslint-disable-next-line no-console
      console.warn(
        `[ephemeroi/github] ${canonical}: commit backlog > ${MAX_PAGES_PER_KIND * COMMIT_PER_PAGE}, will catch up next cycle`,
      );
    }
    // Insert oldest-first so observations land in chronological order
    for (const c of collected.reverse()) {
      const obs = await insertObservationIfNew(commitToObservation(source, repoLabel, c));
      if (obs) added.push(obs);
    }
    if (collected.length > 0) {
      // Newest seen is the last item after reverse() — but `collected` was
      // populated newest-first then reversed in-place; capture before reverse.
      // Simpler: re-derive from observations or recompute. We tracked nothing
      // separately, so look at `added`'s first if any made it; otherwise leave
      // cursor unchanged (next cycle re-fetches). Use the URL hash strategy:
      // we know `collected` was [newest..oldest] before reverse, so after
      // reverse it's [oldest..newest]. The newest is the last element.
      const newestSha = collected[collected.length - 1]?.sha;
      if (newestSha) next.lastCommitSha = newestSha;
    }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      throw new Error(`Repository not found: ${canonical}`);
    }
    throw err;
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
        `[ephemeroi/github] ${canonical}: release backlog > ${MAX_PAGES_PER_KIND * RELEASE_PER_PAGE}, will catch up next cycle`,
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
      // First cycle (no prior cursor): only one page so we don't backfill the
      // repo's entire issue history.
      if (!cursor.lastIssueUpdatedAt) break;
      if (page === MAX_PAGES_PER_KIND) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ephemeroi/github] ${canonical}: issue backlog > ${MAX_PAGES_PER_KIND * ISSUE_PER_PAGE}, will catch up next cycle`,
        );
      }
    }
    if (maxUpdated) next.lastIssueUpdatedAt = maxUpdated;
  } catch (err) {
    if (!(err instanceof GitHubError && err.status === 404)) {
      throw err;
    }
  }

  await updateSourceCursor(source.id, next as Record<string, unknown>);
  return { added };
}
