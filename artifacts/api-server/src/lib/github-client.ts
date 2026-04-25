import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GitHubError";
  }
}

async function ghGet<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  const qs = query
    ? "?" +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const res = await connectors.proxy("github", `${path}${qs}`, { method: "GET" });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new GitHubError(res.status, `GitHub ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface GhRepo {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  open_issues_count: number;
  language: string | null;
  html_url: string;
  pushed_at: string;
}

export interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; email?: string; date?: string } | null;
  };
  author: { login?: string } | null;
}

export interface GhRelease {
  id: number;
  name: string | null;
  tag_name: string;
  body: string | null;
  html_url: string;
  published_at: string | null;
  author: { login?: string } | null;
}

export interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
  user: { login?: string } | null;
  pull_request?: unknown;
}

export interface GhContent {
  content?: string;
  encoding?: string;
}

export interface GhUserRepo extends GhRepo {
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  private: boolean;
}

export const github = {
  getRepo(owner: string, repo: string): Promise<GhRepo> {
    return ghGet<GhRepo>(`/repos/${owner}/${repo}`);
  },
  // Lists repos OWNED by a user or org (excludes those they only contribute to
  // or have forked elsewhere). Sorted by pushed_at desc so the most active
  // repos are watched first when we cap. type=owner avoids surfacing repos
  // the user merely belongs to via membership; for orgs that's still the right
  // call (owner = repos the org owns). Public-only is enforced upstream by
  // filtering on `private: false`.
  listUserRepos(
    user: string,
    opts?: { perPage?: number; page?: number },
  ): Promise<GhUserRepo[]> {
    return ghGet<GhUserRepo[]>(`/users/${user}/repos`, {
      type: "owner",
      sort: "pushed",
      direction: "desc",
      per_page: opts?.perPage ?? 100,
      page: opts?.page ?? 1,
    });
  },
  listCommits(
    owner: string,
    repo: string,
    opts?: { perPage?: number; sha?: string; until?: string; page?: number },
  ): Promise<GhCommit[]> {
    const q: Record<string, string | number> = { per_page: opts?.perPage ?? 30 };
    if (opts?.sha) q["sha"] = opts.sha;
    if (opts?.until) q["until"] = opts.until;
    if (opts?.page) q["page"] = opts.page;
    return ghGet<GhCommit[]>(`/repos/${owner}/${repo}/commits`, q);
  },
  listReleases(owner: string, repo: string, perPage = 10, page = 1): Promise<GhRelease[]> {
    return ghGet<GhRelease[]>(`/repos/${owner}/${repo}/releases`, { per_page: perPage, page });
  },
  listIssues(
    owner: string,
    repo: string,
    opts?: { since?: string; perPage?: number; direction?: "asc" | "desc"; page?: number },
  ): Promise<GhIssue[]> {
    const q: Record<string, string | number> = {
      per_page: opts?.perPage ?? 30,
      state: "all",
      sort: "updated",
      direction: opts?.direction ?? "asc",
    };
    if (opts?.since) q["since"] = opts.since;
    if (opts?.page) q["page"] = opts.page;
    return ghGet<GhIssue[]>(`/repos/${owner}/${repo}/issues`, q);
  },
  async getReadme(owner: string, repo: string): Promise<string | null> {
    try {
      const data = await ghGet<GhContent>(`/repos/${owner}/${repo}/readme`);
      if (!data.content) return null;
      if (data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
      return data.content;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return null;
      throw err;
    }
  },
};

export interface ParsedRepo {
  owner: string;
  repo: string;
  canonical: string;
}

// GitHub treats owner/repo case-insensitively at the API level. We normalize to
// lowercase for dedup of sources (kind, target) and for the bridge endpoint
// match, so `OpenAI/Gym` and `openai/gym` resolve to the same source row.
export function parseRepoTarget(input: string): ParsedRepo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try full URL first
  try {
    const u = new URL(trimmed);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length >= 2) {
        const owner = parts[0]!.toLowerCase();
        const repo = parts[1]!.replace(/\.git$/, "").toLowerCase();
        if (owner && repo) {
          return { owner, repo, canonical: `${owner}/${repo}` };
        }
      }
    }
    return null;
  } catch {
    // Not a URL, try owner/repo shorthand
  }
  const m = trimmed.match(/^([\w][\w.-]*)\/([\w][\w.-]*)$/);
  if (!m) return null;
  const owner = m[1]!.toLowerCase();
  const repo = m[2]!.toLowerCase();
  return { owner, repo, canonical: `${owner}/${repo}` };
}

export interface ParsedUser {
  user: string;
  canonical: string;
}

// Parses a github user/org target. Accepts:
//   "ylecun"
//   "https://github.com/ylecun"
//   "https://github.com/ylecun/" (trailing slash)
// Rejects anything that looks like owner/repo (those go through parseRepoTarget).
// Same lowercase-canonicalization as parseRepoTarget so dedup works.
export function parseUserTarget(input: string): ParsedUser | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
      // Only accept exactly one path segment — two means owner/repo.
      if (parts.length !== 1) return null;
      const user = parts[0]!.toLowerCase();
      if (!/^[\w][\w-]*$/.test(user)) return null;
      return { user, canonical: user };
    }
    return null;
  } catch {
    // Not a URL, fall through to bare-username matching.
  }
  // Bare username — letters/digits/hyphens, no slashes. GitHub usernames
  // disallow leading hyphen and consecutive hyphens but accepting the
  // looser regex here is fine; the API will 404 invalid ones.
  if (!/^[\w][\w-]*$/.test(trimmed)) return null;
  const user = trimmed.toLowerCase();
  return { user, canonical: user };
}
