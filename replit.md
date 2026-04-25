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
- **Autonomy**: Ephemeroi can autonomously discover and add new GitHub sources based on reflected observations and an LLM judge, guided by existing beliefs and open questions.
- **Constellation Alerts**: Per-source 4D state vector (Capability/Integrity/Usability/Trust) that updates with reflections. High-importance observations trigger "Don" narrated alerts via `EPHEMEROI_DON_URL` (local Ollama or OpenAI fallback).
- **Bridge Endpoint**: `GET /api/ephemeroi/beliefs/by-source` allows Metacog to query Ephemeroi's beliefs about specific watched sources.

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