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

The AI speaks in a single first-person voice across every step. All system prompts (research/code/web) instruct it to be conversational, use "I", and avoid academic register. Steps still emit structured JSON, but every text field reads like a text message.

Step types: `DECOMPOSE`, `RETRIEVE`, `EVALUATE`, `PIVOT`, `SYNTHESIZE`; plus `WEB_SEARCH` and `PATTERN` for web mode; every run ends with `REFLECT` (personal take + autonomous exploration suggestions).

UI:
- `pages/home.tsx` — single-column messaging-app layout with iMessage-style header (avatar + live status pill) and bottom composer
- `components/query-interface.tsx` — `ChatComposer`: mode pills, auto-resizing textarea, Plus button opens code-paste sheet (code mode) or sample-questions sheet (others)
- `components/reasoning-stream.tsx` — `ChatFeed`: user messages right-aligned (primary), AI bubbles left-aligned with per-step accent colors; typing indicator with animated dots; "delivered" stamp on completion

Backend: `artifacts/api-server/src/routes/search/index.ts` (`POST /api/search/metacognitive`, SSE).
Model from `OPENAI_MODEL` env var (default `gpt-5.2`). Express body limit raised to 5mb in `app.ts` for pasted code.

Note: `architecture-legend.tsx` is no longer rendered (replaced by the live status pill in the header) but the file is kept for now.

### Reasoning lenses (RETRIEVE annotation)

Each RETRIEVE step now declares the *posture* it's reading from, not just the source type:
- **VISIBLE** — broad survey, getting bearings
- **INFRARED** — depth/foundation, grounding in theory or first principles
- **UV** — precision/coherence check, verifying a specific claim or resolving a conflict
- **PRISM** — oblique angle, intentional creative pivot when the obvious read has stalled

The model is instructed to switch lenses across a run rather than churn on one. EVALUATE carries a stagnation rule: if confidence isn't climbing across the last two retrievals or the same gap keeps surfacing, it must call out stagnation and trigger PIVOT, with the post-pivot retrieval escalating to PRISM. DECOMPOSE is told to follow a "concave shape" — wide breakdown, tight payoff at SYNTHESIZE.

Lens fields (`lens`, `lensRationale`) are optional in the TS schema (`use-search-stream.ts`) so older runs and fallback parses still render. The renderer shows a small pill on RetrieveBubble (`data-testid="lens-{visible|infrared|uv|prism}"`).
