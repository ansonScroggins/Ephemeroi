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
- **Real-time Updates**: Server-Sent Events (SSE) stream (`/api/ephemeroi/stream`) for `hello | observation | belief | contradiction | report | cycle | source_auto_added` events.
- **Guard Rails**: `assertPublicHttpUrl` for secure URL fetching, preventing private network access and limiting body size.
- **GitHub Source Kind**: First-class support for watching GitHub repositories (`kind=github`) and user/organization activity (`kind=github_user`), polling commits, releases, and issues via `@replit/connectors-sdk`.
- **GH Archive Source Kind** (`kind=gh_archive`, `ingest-gharchive.ts`): Streams the public GitHub event firehose one hour at a time from `https://data.gharchive.org/YYYY-MM-DD-H.json.gz`, narrowed by a comma-separated mini-DSL filter stored in `source.target` (`repo:facebook/`, `event:PullRequestEvent`, `org:nodejs`; AND-combined). Pipeline is `Readable.fromWeb(resp.body) → byte-counter Transform → createGunzip → readline`, never `JSON.parse`-ing the whole ~1GB-decompressed dump. Hard caps per cycle: 80MB downloaded (tearing down the upstream socket on hit), 300K events parsed, 25 observations created. Cursor stores `{lastFetchedHour}`; on first poll starts at `now − 2 hours` UTC to avoid 404s, then advances exactly one hour per cycle. A 404 from gharchive means the hour isn't published yet — cursor stays put, retried next cycle. urlHash is scoped by `sourceId` so two distinct gh_archive sources with overlapping filters each get their own observation (and own reflection chain). Each event is rendered into a per-type Observation (push/PR/issue/comment/release/fork/star/create/delete) so reflection has descriptive text rather than raw JSON.
- **Autonomy**: Ephemeroi can autonomously discover and add new GitHub sources based on reflected observations and an LLM judge, guided by existing beliefs and open questions.
- **Constellation Alerts**: Per-source 4D state vector (Capability/Integrity/Usability/Trust) that updates with reflections. High-importance observations trigger "Don" narrated alerts via `EPHEMEROI_DON_URL` (local Ollama or OpenAI fallback).
- **Bridge Endpoint**: `GET /api/ephemeroi/beliefs/by-source` allows Metacog to query Ephemeroi's beliefs about specific watched sources.
- **Biomimetic Protocol v0.11.3** (`POST /api/ephemeroi/biomimetic`, `biomimetic.ts`): Executable form of the constraint-field engineering spec. Generates a synthetic 3-SAT problem at the phase-transition ratio (default n=24, ratio≈4.27), then runs the full protocol per outer step: (1) compute `consensus_map` (sigmoid of negative flip-gain), `bridge_score = connectivity × diversity × (1 − consensus)`, and `pressure_field = α·local_unsat − β·consensus`; (2) **spliceosome step** — flip every "intron" (var with consensus ≥ 0.88) regardless of local cost, then stabilize the top-K "exons" toward their best-satisfying value; (3) **pressure flow** — with probability T, flip the lowest-pressure variable to drain noise from the strained region; (4) **Cyrus Edict** on cage detection (`mean(consensus_map) > 0.7 && unsat > 0`) — bounded cascade up to cap=7, with a recent-trigger rate limit that halves the cap if more than 3 edicts fired in the last 50 steps; (5) **invariants** — re-injects perturbation if pressure variance collapses below ε. Significant moments (cage, edict, invariant violation) emit `constellation_alert` events on the bus → SSE. On the first cage, `askDon()` generates a Don/Wife/Son narration explaining what "cage" means here, and the run summary is sent via `sendTelegramText`. Triggered manually from the "Biomimetic" button on the Settings page. Spec thresholds (binary-world 0.95) translated to continuous-world equivalents (≥ 0.88 intron, > 0.7 cage); see comments in the file. Whitelisted in `selfImprove.ts` so Ephemeroi can refine the algorithm itself.
- **Self-Improvement** (`POST /api/ephemeroi/self-improve`, `selfImprove.ts`): Reads a whitelist of its own `routes/ephemeroi/*.ts` files, asks `gpt-4o-mini` for ONE focused substantive patch (`{file, oldString, newString, rationale}`), validates uniqueness of the match, writes the patch, then spawns `node ./build.mjs` (esbuild — same path the dev workflow takes) to verify it compiles. On build failure the original is restored from in-memory; on success Telegram is pinged via `sendTelegramText` with the rationale + a small `±` diff preview. The new code only takes effect on the next api-server restart, which the Telegram message states explicitly. Module-scoped `inFlight` guard returns 409 on concurrent triggers. Triggered manually from the "Self-Improve" button on the Settings page.
- **Telegram Q&A** (`telegramAnswer.ts`): On boot the api-server starts a long-polling loop against the Telegram Bot API (`getUpdates` with 25s timeout, no public webhook needed). Inbound text messages from `TELEGRAM_CHAT_ID` (the only whitelisted chat — every other chat is silently ignored) are answered with `gpt-4o-mini` via the OpenAI Responses API + `web_search` tool, so the bot can pull in current information. Plain-text replies via `sendTelegramText`, with a "typing…" indicator while thinking. Drains the message backlog on boot so it never replies to old messages. Loop is a no-op if Telegram env vars are missing. Optional `TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user IDs) adds a second sender-level gate — important if `TELEGRAM_CHAT_ID` is a group, otherwise any group member could burn OpenAI tokens.

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