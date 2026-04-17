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

## Metacognitive AI Search (artifacts/metacognitive-search)

Research-grade web UI that streams structured metacognitive reasoning over SSE. Three modes:

- **Research** — LLM-simulated metacognitive flow (default)
- **Code Review** — paste code, get a metacognitive code review with refactored code in the synthesis step
- **Web Search** — uses OpenAI Responses API `web_search` tool to fetch real live sources, then runs the metacognitive flow grounded in those sources, with a `PATTERN` step that detects recurring themes across the results

Step types: `DECOMPOSE`, `RETRIEVE`, `EVALUATE`, `PIVOT`, `SYNTHESIZE`, plus `WEB_SEARCH` and `PATTERN` (web mode only). Every run ends with a `REFLECT` step where the model drops the formal voice, speaks in the first person, shares personal observations, and proposes 2-4 directions it would explore on its own initiative.

Backend: `artifacts/api-server/src/routes/search/index.ts` (`POST /api/search/metacognitive`, SSE).
Model is read from `OPENAI_MODEL` env var (default `gpt-5.2`). Express body limit raised to 5mb in `app.ts` to accommodate pasted code.
