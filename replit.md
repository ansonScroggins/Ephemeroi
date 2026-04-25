# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Metacognitive AI Search — "Metacog" (artifacts/metacognitive-search)

iMessage/SMS-style chat interface for an autonomous AI that thinks out loud. Three modes selectable as pills above the composer:

- **Think** (research) — pure reasoning
- **Code** — paste code, get refactor + commentary
- **Web** — live web search via OpenAI Responses API + cross-source pattern detection
- **Society** — multi-agent debate sim (Mira/Theo/Vex/Juno + optional Onyx agitator), all on a single OpenAI model (`OPENAI_MODEL`, default `gpt-5.2`). Beliefs are real **embedding vectors**, not scalars. At sim start, each agent's belief vector is initialised by embedding a personality-tinted seed sentence about the topic; a per-sim **stance axis** is built by embedding pro/con anchor sentences (`pro − con`, normalised). Whenever a scalar stance is needed (UI bar, prompt, statement valence) it's the projection of the relevant vector onto that axis. Each round, statements are embedded; non-agitator listeners absorb prior-round statements as a **vector pull** (`belief = normalize(belief + trust × conformity × (1−skepticism) × persuasiveness × 0.35 × (stmt_vec − belief))`); reputation updates use cosine alignment between the listener's prior belief and the statement vector. After each round, a 2D **PCA constellation** is computed via the n×n Gram-trick and emitted as `cluster_positions`. The narrator gets a pairwise-cosine cluster snapshot and is told to call out drift / capture / isolation. UI: agent chips with belief bars, debate feed, circular influence graph (green=pulled toward favor, red=toward opposition), reputation matrix, and the new constellation map (sign-stabilised round-to-round, agitator gets a faint danger ring). Endpoint: `POST /api/society/simulate` (SSE). Backend: `routes/society/index.ts` + `routes/society/embeddings.ts` (helper for `embedBatch`, `cosine`, `normalize`, `lerpToward`, `pca2d`). Hook: `use-society-stream.ts`. View: `society-view.tsx`. Cancels in-flight LLM and embedding calls on client disconnect via AbortController. Embedding model: `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`, 1536-d).

The AI speaks in a single first-person voice across every step. All system prompts (research/code/web) instruct it to be conversational, use "I", and avoid academic register. Steps still emit structured JSON, but every text field reads like a text message.

Step types: `DECOMPOSE`, `RETRIEVE`, `EVALUATE`, `PIVOT`, `SYNTHESIZE`; plus `WEB_SEARCH` and `PATTERN` for web mode; every run ends with `REFLECT` (personal take + autonomous exploration suggestions).

UI:
- `pages/home.tsx` — single-column messaging-app layout with iMessage-style header (avatar + live status pill) and bottom composer
- `components/query-interface.tsx` — `ChatComposer`: mode pills, auto-resizing textarea, Plus button opens code-paste sheet (code mode) or sample-questions sheet (others)
- `components/reasoning-stream.tsx` — `ChatFeed`: user messages right-aligned (primary), AI bubbles left-aligned with per-step accent colors; typing indicator with animated dots; "delivered" stamp on completion

Backend: `artifacts/api-server/src/routes/search/index.ts` (`POST /api/search/metacognitive`, SSE).
Model from `OPENAI_MODEL` env var (default `gpt-5.2`). Express body limit raised to 5mb in `app.ts` for pasted code.

**Groq fast path for Research mode.** When `GROQ_API_KEY` is present, Research (Think) mode is routed through Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`) with `GROQ_MODEL` (default `llama-3.3-70b-versatile`) for noticeably faster streaming. Web mode stays on OpenAI (needs the Responses API + `web_search` tool); Code mode stays on OpenAI for parity. The chosen provider/model is sent in the SSE `started` event and surfaced in the chat header as a small `⚡ Groq` badge (`data-testid="badge-provider"`). The Groq client is the standard `openai` SDK pointed at Groq's base URL — re-exported from `@workspace/integrations-openai-ai-server` as `OpenAI` (value) + `OpenAIClient` (type) so api-server doesn't need a direct `openai` dep.

Note: `architecture-legend.tsx` is no longer rendered (replaced by the live status pill in the header) but the file is kept for now.

### Reasoning lenses (RETRIEVE annotation)

Each RETRIEVE step now declares the *posture* it's reading from, not just the source type:
- **VISIBLE** — broad survey, getting bearings
- **INFRARED** — depth/foundation, grounding in theory or first principles
- **UV** — precision/coherence check, verifying a specific claim or resolving a conflict
- **PRISM** — oblique angle, intentional creative pivot when the obvious read has stalled

The model is instructed to switch lenses across a run rather than churn on one. EVALUATE carries a stagnation rule: if confidence isn't climbing across the last two retrievals or the same gap keeps surfacing, it must call out stagnation and trigger PIVOT, with the post-pivot retrieval escalating to PRISM. DECOMPOSE is told to follow a "concave shape" — wide breakdown, tight payoff at SYNTHESIZE.

Lens fields (`lens`, `lensRationale`) are optional in the TS schema (`use-search-stream.ts`) so older runs and fallback parses still render. The renderer shows a small pill on RetrieveBubble (`data-testid="lens-{visible|infrared|uv|prism}"`).

### GitHub retrieval + Ephemeroi belief bridge
When a query contains a `github:` prefix, a github.com URL, or a heuristic `owner/repo` token (stopwords excluded; requires `[-_.\d]` to avoid false positives like `apples/oranges`), Metacog runs a pre-LLM retrieval step before the model produces its plan.
- `detectGithubRef(query)` in `routes/search/index.ts` returns the canonical `owner/repo` or null.
- `fetchGithubContext(ref)` pulls repo metadata + README (truncated to 3 KB) + last 5 commits + latest release via `github-client.ts`.
- A synthetic `RETRIEVE` step is emitted with `sourceType:"empirical"`, `lens:"VISIBLE"`, references `["github:owner/repo", "https://github.com/owner/repo"]`. The findings block is also spliced into the LLM's user prompt as `preContextBlock` so reasoning is grounded.
- A second synthetic `RETRIEVE` step (`sourceType:"infrared"`, `lens:"INFRARED"`, label "Ephemeroi's running take on owner/repo") fires only if `listBeliefsBySource("github", ref)` returns non-empty beliefs or contradictions. Top 3 by confidence + open contradictions.
- Skipped when `mode === "code"` (we don't want code-mode answers polluted by general repo metadata).

### Persistent memory (déjà vu)

Client-side memory of past runs lives in `src/lib/memory.ts` (localStorage, key `metacog:memory:v1`, capped at 50 entries LRU). Each entry stores: query, mode, REFLECT `personalSummary`, SYNTHESIZE `finalConfidence`, lenses used, and normalized tokens for similarity matching.

- Persisted on run completion in `home.tsx` (only if a `REFLECT.personalSummary` arrived; that's the durable insight worth remembering).
- Lookup: `findSimilar(query, mode)` does Jaccard over normalized tokens (stopwords stripped, ≥3 chars), threshold `0.32`, mode-scoped.
- UI: `components/memory-pill.tsx` renders an amber pill above the composer when a match is found while typing. Click to expand (shows past query, conclusion, confidence, lenses). "use that exact question" prefills the composer via a `prefill={query, nonce}` prop. "X" dismisses it for the session via a per-id dismissed set.

Test IDs: `memory-pill`, `button-memory-toggle`, `button-memory-dismiss`, `button-memory-reuse`, `memory-detail`.

## Ephemeroi — autonomous explorer (artifacts/ephemeroi + api-server/routes/ephemeroi)

Always-on background observer that watches the world (RSS feeds, URLs, search topics), embeds observations into memory, reflects via LLM to evolve beliefs and detect contradictions, and surfaces "reports" when something crosses an importance threshold. Reports are pushed to Telegram and to a live in-app dashboard.

### Backend (`artifacts/api-server/src/routes/ephemeroi/`)
- `loop.ts` — `EphemeroiLoop` singleton. `setTimeout`-driven schedule honoring `settings.intervalSeconds`. `inFlight` guard prevents overlapping cycles. `runOnce({throwOnError:true})` surfaces failures as HTTP 500 from the manual-trigger route; scheduled `tick()` swallows + re-schedules so the loop self-heals.
- `ingest.ts` — RSS via `rss-parser`'s `parseString` + URL fetch via `safePublicFetch`. Search-source kind is a stub (synthesises a daily prompt observation) until a real web-search provider is wired up. Dedup by `urlHash` (SHA-256, 32 hex chars), unique index on `ephemeroi_observations.url_hash`.
- `guard.ts` — `assertPublicHttpUrl` rejects non-http(s), localhost-style hostnames, and DNS-resolved private addresses (10/8, 127/8, 169.254/16, 172.16-31, 192.168/16, 100.64/10 CGNAT, multicast, link-local IPv6, ULA, IPv4-mapped IPv6). `safePublicFetch` enforces the guard at every redirect hop (`redirect: "manual"`, max 5 hops) and caps body size at 5 MiB. Note: residual DNS-rebinding TOCTOU between resolve and connect is acknowledged (would need a custom `https.Agent` lookup hook).
- `reflect.ts` — `gpt-4o-mini` (override via `EPHEMEROI_REFLECTION_MODEL`) with `response_format: json_object`. Returns `{importance, headline (≤120), message (≤600), beliefUpdates[≤3], contradictions[≤2]}`. Bad JSON / LLM failure falls back to novelty-derived importance.
- Importance is **blended** in the loop: `effective = importance × (1 − noveltyWeight) + novelty × noveltyWeight`, clamped 0..1. Novelty itself is `1 − maxCosine(observation, last 200 embedded observations)`; embeddings come from `routes/society/embeddings.ts` (text-embedding-3-small, 1536-d). Observations later in the same batch are added to the running reference set so they don't all look novel against the same baseline.
- `store.ts` — Drizzle queries. `getSettings()` is race-safe singleton bootstrap (insert default, then re-select asc-id-limit-1; concurrent first callers converge). `upsertBelief` matches by exact proposition string and adjusts confidence by `deltaConfidence` (clamped −1..1).
- `telegram.ts` — POSTs to Bot API with markdown-escaped headline+body. Failures are logged and swallowed so the cycle never crashes on Telegram errors; `delivered`/`deliveredAt` only flip when send succeeds. Gracefully no-ops if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are missing.
- `bus.ts` + `/api/ephemeroi/stream` (SSE) — emits `{type, payload}` envelopes on the **default `message` channel** (so `EventSource.onmessage` in the browser picks it up without per-type listeners). Cleanup is bound to `res.on("close")`/`res.on("error")` with an idempotent guard. 25s `: ping` heartbeat. Event types: `hello | observation | belief | contradiction | report | cycle | source_auto_added`.
- `index.ts` wires all routes plus `ephemeroiLoop.start()` on first import.

### DB schema (`lib/db/src/schema/ephemeroi.ts`)
- `ephemeroi_settings` (singleton; defaults: 300s interval, 0.55 threshold, paused=false, telegramEnabled=true, noveltyWeight=0.5, autonomyEnabled=false, autonomyMaxSources=50)
- `ephemeroi_sources` (kind: rss|url|search|github|github_user, unique on (kind, target), `cursor` jsonb for per-source poll bookmarks; `github_user` cursor stores `{repos: {"owner/repo": {lastCommitSha,lastReleaseId,lastIssueUpdatedAt}, ...}, lastUserSync}` for per-repo bookmarks within a single user/org watch; `autoAdded`/`autoAddedReason`/`autoAddedAt` for sources Ephemeroi added to itself via the Autonomy pass)
- `ephemeroi_observations` (jsonb embedding `number[]`, doublePrecision novelty/importance, unique on `url_hash`, indexes on `observed_at` and `reflected`)
- `ephemeroi_beliefs` (proposition, confidence −1..1, supportCount, contradictCount, embedding, `originSourceId` nullable FK-less integer for source-of-origin tracking; populated on insert and backfilled on update if previously null)
- `ephemeroi_contradictions` (beliefId nullable, observationId nullable, summary, resolved)
- `ephemeroi_reports` (importance, headline, body, observationIds jsonb, delivered/deliveredAt)
- FK constraints intentionally absent so deleting a source does not delete its history.

### Frontend (`artifacts/ephemeroi/`)
React + Vite SPA at `/ephemeroi/`. Sidebar nav: Overview / Sources / Beliefs / Tensions / Reports / Settings. All pages use generated React Query hooks from `@workspace/api-client-react`. `use-ephemeroi-stream.ts` opens a single `EventSource` to `/api/ephemeroi/stream` and invalidates relevant queries on each event; reports + contradictions also fire toasts. Dark theme matches Metacog.

### OpenAPI
All routes live under `/ephemeroi/*` in `lib/api-spec/openapi.yaml` except the SSE stream (intentionally outside the spec — orval doesn't model SSE well; the frontend uses native EventSource).

### Operational notes
- Loop auto-starts on api-server boot. Default interval 5 min; lower to 30–120s while testing.
- To verify end-to-end: POST `/api/ephemeroi/sources` with HN feed `https://news.ycombinator.com/rss`, lower threshold via PUT settings, then POST `/api/ephemeroi/cycle/run`.
- Telegram delivery requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` secrets; loop silently skips delivery when missing.
- Search-source kind is a v1 stub. Real web search ingestion (Tavily/Brave) is a deliberate follow-up.

### GitHub source kind
GitHub repos are first-class observation sources alongside RSS/URL/search.
- **Auth**: `@replit/connectors-sdk` (`ReplitConnectors.proxy("github", path)`) via the active GitHub connection. No PAT required; OAuth managed by Replit.
- **Client**: `artifacts/api-server/src/lib/github-client.ts` — `parseRepoTarget(input)` accepts `owner/repo` or full github.com URL and canonicalizes to `owner/repo`; `parseUserTarget(input)` accepts a bare username or `https://github.com/<user>` URL (rejects two-segment paths so they fall through to `parseRepoTarget`); `github.{getRepo,listCommits,listReleases,listIssues,getReadme,listUserRepos}`; `GitHubError(status,msg)` for non-2xx.
- **Single-repo ingestion** (`kind=github`): `routes/ephemeroi/ingest-github.ts` `ingestGithub(source)` → `ingestSingleRepo(source, owner, repo, cursor)` polls commits / releases / issues bookmarked by per-source `cursor.{lastCommitSha,lastReleaseId,lastIssueUpdatedAt}`. Up to MAX_PAGES_PER_KIND=5 pages per kind per cycle (paginated via `?until=` for commits, `?page=` for releases, ascending `?since=` for issues). First cycle is capped to 1 page so a fresh source doesn't backfill the entire history. Cursor advances only on success; partial failures keep prior cursor so we re-try next cycle. Rate-limit (429) is logged and re-thrown as `GitHubError` so the loop's normal `lastError` path handles it without crashing.
- **Whole-user ingestion** (`kind=github_user`): `ingestGithubUser(source)` lists owned repos via `/users/<user>/repos?type=owner&sort=pushed`, filters to public + non-fork + non-archived + non-disabled, takes the top MAX_REPOS_PER_USER=30 by recent push, then runs `ingestSingleRepo` against each. Per-repo cursors live inside `cursor.repos["owner/repo"]` so adding a new repo mid-life starts at "now". Per-repo errors are logged and skipped (one bad repo doesn't kill the cycle); the source is only marked errored if EVERY candidate repo failed.
- **Public-only v1**: we only read; no writes back to GitHub (no comments/issues/PRs). Private-repo support is a follow-up gated on an explicit settings toggle.
- **UI**: `artifacts/ephemeroi/src/pages/sources.tsx` adds "GitHub Repo" and "GitHub User / Org" select options. Repo form validates `owner/repo` or `https://github.com/owner/repo`; user form validates a bare username/org or `https://github.com/<user>` URL. Github + Users icons from lucide-react. Backend re-validates and canonicalizes before insert (case-insensitive dedup).

### Autonomy — Ephemeroi adds its own GitHub sources
Off by default. When `settings.autonomyEnabled` is true, after each cycle's reflection step the bot scans the just-reflected observations for GitHub references and may add up to **2 new sources per cycle**, subject to a total ceiling (`settings.autonomyMaxSources`, default 50).
- `routes/ephemeroi/discover.ts` — three-layer false-positive defense:
  1. Lexical extraction with strict `owner/repo` and `github.com/<user>` regexes; URL form is unconditionally accepted, bare `owner/repo` form requires the literal word "github" within ±120 chars (kills prose like "days/weeks", "pros/cons").
  2. `FALSE_POSITIVE_OWNERS` deny-list (English words, time units, URL/path tokens). `RESERVED_USERS` deny-list for github.com routes (about, login, marketplace, …).
  3. LLM judge (gpt-4o-mini, JSON-only) framed as a *curious learner that learns one thing at a time*: it sees (a) settled beliefs, (b) the **frontier** of low-confidence beliefs, (c) **open questions** (unresolved contradictions), and (d) the existing watched-source list with per-owner overlap counts. Each pick must justify itself with `Resolves:` (an open question), `Deepens:` (a frontier belief), or `Opens:` (a new sub-question). Lateral / redundant picks (same owner already watched, same already-confident belief) are explicitly rejected. Max 2 picks per cycle.
- `trimRepoSuffix` strips trailing `.git` and prose punctuation greedily eaten by the repo regex (so refs at sentence boundaries still match).
- Discovery only runs when `unreflected.length > 0` (each ref is evaluated exactly once when first seen). Failures are caught + logged; never break the cycle.
- `createSource({autoAdded:true, autoAddedReason})` is idempotent via `onConflictDoNothing`. SSE event `source_auto_added` fires per added source so the UI can toast + refresh the sources list.
- Audit trail: `ephemeroi_sources.{auto_added, auto_added_reason, auto_added_at}` columns; UI shows a "Auto-watched" badge with the reason quoted underneath.
- Settings UI exposes a toggle + max-sources slider. Cycle response (`runEphemeroiCycle`) returns `autoSourcesAdded` count.

### Bridge endpoint — `GET /api/ephemeroi/beliefs/by-source`
Lets Metacog ask "what does Ephemeroi currently believe about this watched source?".
- Query: `?kind=github&target=owner/repo` or `?kind=github_user&target=username` (kind enum matches sources; target validated/canonicalized server-side for both github kinds).
- Returns `{source, beliefs[{proposition,confidence,supportCount,contradictCount,…}], contradictions[{summary,resolved,…}]}` ordered by belief confidence desc. Empty arrays if no origin-tracked beliefs (legacy beliefs without origin are intentionally not returned to keep the surface honest).
- `originSourceId` is set on belief insert AND backfilled on update when previously null, so existing beliefs naturally accrue origin tracking as new observations contribute to them.
