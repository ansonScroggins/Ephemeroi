# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for building AI-powered applications. It features two main components: "Metacognitive AI Search" (Metacog), an iMessage/SMS-style chat interface for an autonomous AI, and "Ephemeroi," an always-on background observer that autonomously explores and reports on information. The core vision is to create intelligent agents that can reason, code, search the web, and engage in multi-agent simulations, all while maintaining persistent memory and autonomously curating knowledge.

The project leverages modern web technologies and AI models to provide a conversational and insightful user experience, pushing the boundaries of autonomous AI functionality, including self-curation of information sources and dynamic belief systems.

# User Preferences

The AI speaks in a single first-person voice across every step. All system prompts (research/code/web) instruct it to be conversational, use "I", and avoid academic register. Steps still emit structured JSON, but every text field reads like a text message.

# System Architecture

## Core Technologies
- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package Manager**: pnpm
- **TypeScript**: 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Metacognitive AI Search ("Metacog")
- **Interface**: iMessage/SMS-style chat with a single-column messaging-app layout.
- **AI Modes**:
    - **Think (research)**: Pure reasoning.
    - **Code**: Code refactoring and commentary.
    - **Web**: Live web search with cross-source pattern detection.
    - **Society**: Multi-agent debate simulation with dynamic belief vectors, reputation, and PCA constellation visualization.
- **Reasoning Lenses**: `VISIBLE`, `INFRARED`, `UV`, `PRISM` to guide retrieval steps and prevent stagnation.
- **GitHub Integration**: Pre-LLM retrieval for GitHub URLs or `owner/repo` patterns, fetching repo metadata, README, commits, and releases.
- **Persistent Memory**: Client-side (localStorage) LRU cache of past runs (query, mode, summary, confidence, lenses) for "déjà vu" functionality, offering similar past answers.
- **Groq Fast Path**: Research mode can optionally use Groq for faster streaming responses when `GROQ_API_KEY` is present.
- **UI Components**: `ChatComposer` with mode pills, `ChatFeed` with user/AI bubbles, `ReasoningStream` for step-by-step AI output.

## Ephemeroi – Autonomous Explorer
- **Functionality**: Always-on background observer for RSS feeds, URLs, and search topics. Embeds observations, reflects via LLM to evolve beliefs, detect contradictions, and generate reports.
- **Ingestion**: RSS via `rss-parser`, URL fetch via `safePublicFetch`. Deduplication by `urlHash` (SHA-256).
- **Reflection**: Uses `gpt-4o-mini` (or `EPHEMEROI_REFLECTION_MODEL`) to determine importance, generate headlines/messages, and manage belief updates/contradictions. Importance calculation blends intrinsic importance with novelty.
- **Persistence**: Drizzle ORM for `ephemeroi_settings`, `ephemeroi_sources`, `ephemeroi_observations`, `ephemeroi_beliefs`, `ephemeroi_contradictions`, `ephemeroi_reports`.
- **Real-time Updates**: Server-Sent Events (SSE) stream (`/api/ephemeroi/stream`) for `hello | observation | belief | contradiction | report | cycle | source_auto_added | source_state | constellation_alert` events. `source_state` carries the per-source 4D vector + last delta; `constellation_alert` carries a fully composed alert (formatted block + Don narration + structured vector/delta) for downstream consumers.
- **Guard Rails**: `assertPublicHttpUrl` for secure URL fetching, preventing private network access and limiting body size.
- **GitHub Source Kind**: First-class support for watching GitHub repositories (`kind=github`) and user/organization activity (`kind=github_user`), polling commits, releases, and issues via `@replit/connectors-sdk`.
- **GH Archive Source Kind** (`kind=gh_archive`, `ingest-gharchive.ts`): Streams the public GitHub event firehose one hour at a time from `https://data.gharchive.org/YYYY-MM-DD-H.json.gz`, narrowed by a comma-separated mini-DSL filter stored in `source.target` (`repo:facebook/`, `event:PullRequestEvent`, `org:nodejs`; AND-combined). Pipeline is `Readable.fromWeb(resp.body) → createGunzip → readline`, line-by-line `JSON.parse`, never loading the ~1GB-decompressed dump into memory. Per-cycle caps: 120MB downloaded (two-layered: Content-Length pre-check before streaming + mid-stream byte counter that calls `controller.abort()` if the header was missing/wrong), 300K events parsed, 25 observations created. Cursor stores `{lastFetchedHour}`; on first poll starts at `now − 2 hours` UTC to avoid 404s, then advances exactly one hour per cycle. **Cursor policy:** 404 (hour not yet published) and any network/decode error leave the cursor put for retry; oversize hours (Content-Length OR mid-stream cap) advance the cursor and skip permanently to preserve liveness; cap-induced early exit on event/obs counts advances normally. urlHash is scoped by `sourceId` so two distinct gh_archive sources with overlapping filters each get their own observation (and own reflection chain). Each event is rendered into a per-type Observation (push/PR/issue/comment/release/fork/star/create/delete) so reflection has descriptive text rather than raw JSON.
- **Autonomy**: Ephemeroi can autonomously discover and add new GitHub sources based on reflected observations and an LLM judge, guided by existing beliefs and open questions.
- **Constellation Alerts**: Per-source 4D state vector (Capability/Integrity/Usability/Trust) that updates with reflections. Reflection's optional `stateDelta` (each axis clamped to ±0.3) and `insight` are persisted on `ephemeroi_source_state` (one row per source, FK-less so deleting a source preserves history). Reports clearing `EPHEMEROI_CONSTELLATION_THRESHOLD` (default 0.75) take the Constellation path: `composeConstellationAlert` builds a Don/Wife/Son narration via `askDon` (`EPHEMEROI_DON_URL` Ollama first, OpenAI `EPHEMEROI_DON_FALLBACK_MODEL` second, stub last — never throws), formats a plain-text block with C/I/U/T pre→post values + ▲/▼/· arrows + percentages + the extracted insight, then `sendConstellationAlert` ships it via Telegram (no parse_mode so the table layout survives). The formatted block is always logged so it's auditable even when Telegram is unconfigured. The Sources page renders a 4-bar mini-display per source with Δ arrows and the last insight as a quote.
- **Bridge Endpoint**: `GET /api/ephemeroi/beliefs/by-source` allows Metacog to query Ephemeroi's beliefs about specific watched sources.
- **Biomimetic Protocol v0.11.3** (`POST /api/ephemeroi/biomimetic`, `biomimetic.ts`): Executable form of the constraint-field engineering spec. Generates a synthetic 3-SAT problem at the phase-transition ratio (default n=24, ratio≈4.27), then runs the full protocol per outer step: (1) compute `consensus_map` (sigmoid of negative flip-gain), `bridge_score = connectivity × diversity × (1 − consensus)`, and `pressure_field = α·local_unsat − β·consensus`; (2) **spliceosome step** — flip every "intron" (var with consensus ≥ 0.88) regardless of local cost, then stabilize the top-K "exons" toward their best-satisfying value; (3) **pressure flow** — with probability T, flip the lowest-pressure variable to drain noise from the strained region; (4) **Cyrus Edict** on cage detection (`mean(consensus_map) > 0.7 && unsat > 0`) — bounded cascade up to cap=7, with a recent-trigger rate limit that halves the cap if more than 3 edicts fired in the last 50 steps; (5) **invariants** — re-injects perturbation if pressure variance collapses below ε. Significant moments (cage, edict, invariant violation) emit `constellation_alert` events on the bus → SSE. On the first cage, `askDon()` generates a Don/Wife/Son narration explaining what "cage" means here, and the run summary is sent via `sendTelegramText`. Triggered manually from the "Biomimetic" button on the Settings page. Spec thresholds (binary-world 0.95) translated to continuous-world equivalents (≥ 0.88 intron, > 0.7 cage); see comments in the file. Whitelisted in `selfImprove.ts` so Ephemeroi can refine the algorithm itself.
- **Self-Improvement** (`POST /api/ephemeroi/self-improve`, `selfImprove.ts`): Reads a whitelist of its own `routes/ephemeroi/*.ts` files, asks `gpt-4o-mini` for ONE focused substantive patch (`{file, oldString, newString, rationale}`), validates uniqueness of the match, writes the patch, then spawns `node ./build.mjs` (esbuild — same path the dev workflow takes) to verify it compiles. On build failure the original is restored from in-memory; on success Telegram is pinged via `sendTelegramText` with the rationale + a small `±` diff preview. The new code only takes effect on the next api-server restart, which the Telegram message states explicitly. Module-scoped `inFlight` guard returns 409 on concurrent triggers. Triggered manually from the "Self-Improve" button on the Settings page.
- **Telegram Q&A** (`telegramAnswer.ts`): On boot the api-server starts a long-polling loop against the Telegram Bot API (`getUpdates` with 25s timeout, no public webhook needed). Inbound text messages from `TELEGRAM_CHAT_ID` (the only whitelisted chat — every other chat is silently ignored) are answered with `gpt-4o-mini` via the OpenAI Responses API + `web_search` tool, so the bot can pull in current information. Plain-text replies via `sendTelegramText`, with a "typing…" indicator while thinking. Drains the message backlog on boot so it never replies to old messages. Loop is a no-op if Telegram env vars are missing. Optional `TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user IDs) adds a second sender-level gate — important if `TELEGRAM_CHAT_ID` is a group, otherwise any group member could burn OpenAI tokens.

## Unified Cross-Site Telegram Stream
- **Shared signal envelope** (`lib/signal-envelope.ts`): both Ephemeroi (structural / constellation) and Metacog (truth-anchor / exploration) describe outbound alerts as a single `SignalEnvelope` shape — `{origin: "ephemeroi"|"metacog", role: "structural"|"truth-anchor"|"exploration", severity: 0–1, headline, body, subject?, evidence?}`. `publishSignal()` validates and emits onto an in-process `signalBus` (Node `EventEmitter`). The OpenAPI spec exports the same shape under `SignalEnvelope`.
- **Convergence subscriber** (`routes/ephemeroi/convergence.ts`, started from `routes/ephemeroi/index.ts`): single subscriber on `signalBus` that owns all unified-stream Telegram delivery.
  - **Single-limb sends** wrap the payload with an origin/role badge: `[Ephemeroi · structural]` or `[Metacog · truth-anchor]` etc., followed by `severity NN/100` and the body. For Ephemeroi structural alerts, the rich Don/state-vector block from `composeConstellationAlert` rides along in `evidence.formatted` and is emitted verbatim under the badge.
  - **Cross-limb merge**: every envelope is buffered for `EPHEMEROI_CONVERGENCE_MERGE_MS` (default 3000ms). If a counterpart from the OTHER limb arrives during that window with an overlapping subject (≥1 shared significant token of length ≥4 after a small stopword filter), the pending timer is cancelled and a single `[Cross-limb · ephemeroi+metacog]` message is sent with both limb blocks in canonical order (Ephemeroi first).
  - **Cross-limb correlation**: after sending, each envelope is stashed in a recent-sends window (`EPHEMEROI_CONVERGENCE_WINDOW_MS`, default 5min, capped at 256 entries). A later envelope from the OTHER limb with overlapping subject goes out as `[Cross-limb correlation · ephemeroi+metacog]` instead of a stand-alone single-limb message. *Engineering compromise*: a strict reading of "merge into a single cross-limb alert" within 5 min would require delaying every envelope by 5 min, which is unacceptable for time-sensitive structural cage detection. Instead, we deliver the first envelope after the 3 s merge window and then emit a correlation pointer when a counterpart arrives later in the recent-window — so the user sees up to two messages per pair, but the second one is explicitly tagged as correlated.
  - **Same-origin burst dedupe**: if multiple envelopes arrive from the SAME limb on the same subject while one is still pending in the merge buffer, the timer is **not** reset (chatty sources can't starve the queue) and the highest-severity envelope wins. Tokens from later envelopes are union'd in so a slightly different subject phrasing can still match a counterpart from the OTHER limb.
  - Telegram failures are logged but never propagate. The fully-rendered text is always written to the structured log first, so the audit trail survives a missing/unreachable Telegram bot. Convergence is fire-and-forget (`signalBus.emit` is sync; delivery work is detached so producers never block on Telegram).
- **Inbound endpoint** `POST /api/ephemeroi/signal`: accepts a `SignalEnvelope` POSTed from another site (Metacog when run out of process). Returns 503 if `EPHEMEROI_SIGNAL_SECRET` is unset (the default deployment runs both sites in-process, so the in-memory bus already delivers); 401 if `x-ephemeroi-signal-secret` header is missing/wrong; 400 on validation failure; 202 on accept (the convergence subscriber handles delivery). To enable, add `EPHEMEROI_SIGNAL_SECRET` via the Secrets pane.
- **Wiring**: Ephemeroi's `loop.ts` no longer calls `sendConstellationAlert` directly — when a report clears `EPHEMEROI_CONSTELLATION_THRESHOLD` it composes the alert as before, then `publishSignal()`s onto the bus with the formatted block in `evidence.formatted`. Metacog's `search/truth-anchor` and `search/exploration` routes already call `publishSignal()` on every successful run. Reports remain "delivered" once handed off to the convergence layer (mirrors the pre-convergence ack semantics).
- **Out of scope for v1**: a separate bot service, a persistent signal log (audit lives in structured logs), replay, and any cross-limb auth beyond the shared header secret.

## UI/UX
- **Metacog**: iMessage-style layout with avatar, live status, and per-step accent colors.
- **Ephemeroi**: React + Vite SPA with overview, sources, beliefs, tensions, reports, and settings pages. Uses generated React Query hooks. Dark theme matches Metacog.
- **Visualizations**: Society mode features agent chips with belief bars, influence graphs, reputation matrix, and PCA constellation map. Ephemeroi sources display 4-bar mini-displays for state vectors.

# External Dependencies

- **OpenAI API**: For `gpt-5.2` (or `OPENAI_MODEL`), `text-embedding-3-small` (or `OPENAI_EMBEDDING_MODEL`) for Metacog and Ephemeroi reflections, and web search (Responses API).
- **Groq API**: Optional fast path for Metacog's Research mode, using `llama-3.3-70b-versatile` (or `GROQ_MODEL`).
- **PostgreSQL**: Primary database for Ephemeroi's persistent storage.
- **Drizzle ORM**: ORM for interacting with PostgreSQL.
- **Zod**: Schema validation.
- **Orval**: OpenAPI specification code generation.
- **`rss-parser`**: For parsing RSS feeds in Ephemeroi.
- **`@replit/connectors-sdk`**: For GitHub integration authentication and API proxying.
- **Telegram Bot API**: Optional integration for Ephemeroi reports delivery (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- **Ollama**: Optional local LLM for "Don" narration in Ephemeroi constellation alerts (`EPHEMEROI_DON_URL`, `EPHEMEROI_DON_MODEL`).