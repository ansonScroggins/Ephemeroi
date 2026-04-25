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

### Persistent memory (déjà vu)

Client-side memory of past runs lives in `src/lib/memory.ts` (localStorage, key `metacog:memory:v1`, capped at 50 entries LRU). Each entry stores: query, mode, REFLECT `personalSummary`, SYNTHESIZE `finalConfidence`, lenses used, and normalized tokens for similarity matching.

- Persisted on run completion in `home.tsx` (only if a `REFLECT.personalSummary` arrived; that's the durable insight worth remembering).
- Lookup: `findSimilar(query, mode)` does Jaccard over normalized tokens (stopwords stripped, ≥3 chars), threshold `0.32`, mode-scoped.
- UI: `components/memory-pill.tsx` renders an amber pill above the composer when a match is found while typing. Click to expand (shows past query, conclusion, confidence, lenses). "use that exact question" prefills the composer via a `prefill={query, nonce}` prop. "X" dismisses it for the session via a per-id dismissed set.

Test IDs: `memory-pill`, `button-memory-toggle`, `button-memory-dismiss`, `button-memory-reuse`, `memory-detail`.
