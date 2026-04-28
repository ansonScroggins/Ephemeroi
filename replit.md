# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for building AI-powered applications. Its core vision is to create intelligent agents that can reason, code, search the web, and engage in multi-agent simulations, all while maintaining persistent memory and autonomously curating knowledge. Key capabilities include "Metacognitive AI Search" (Metacog), an iMessage/SMS-style chat interface for an autonomous AI, and "Ephemeroi," an always-on background observer that autonomously explores and reports on information. The project aims to push the boundaries of autonomous AI functionality, including self-curation of information sources and dynamic belief systems, to provide a conversational and insightful user experience.

# User Preferences

The AI speaks in a single first-person voice across every step. All system prompts (research/code/web) instruct it to be conversational, use "I", and avoid academic register. Steps still emit structured JSON, but every text field reads like a text message.

# System Architecture

## Core Technologies
- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod
- **API Codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild

## Metacognitive AI Search ("Metacog")
- **Interface**: iMessage/SMS-style chat with a single-column messaging-app layout.
- **AI Modes**: Think (pure reasoning), Code (refactoring/commentary), Web (live search with pattern detection), Society (multi-agent debate simulation with belief vectors and reputation).
- **Reasoning Lenses**: `VISIBLE`, `INFRARED`, `UV`, `PRISM` to guide retrieval.
- **GitHub Integration**: Pre-LLM retrieval for GitHub URLs.
- **Persistent Memory**: Client-side (localStorage) LRU cache for "déjà vu" functionality.
- **Groq Fast Path**: Optional streaming responses for Research mode.
- **UI**: `ChatComposer`, `ChatFeed`, `ReasoningStream` for step-by-step AI output.

## Ephemeroi – Autonomous Explorer
- **Functionality**: Always-on background observer for RSS feeds, URLs, and search topics. Embeds observations, reflects via LLM to evolve beliefs, detect contradictions, and generate reports.
- **Ingestion**: RSS via `rss-parser`, URL fetch via `safePublicFetch`. Deduplication by `urlHash`.
- **Reflection**: Uses `gpt-4o-mini` (or `EPHEMEROI_REFLECTION_MODEL`) to determine importance, generate headlines/messages, and manage belief updates/contradictions.
- **Persistence**: Drizzle ORM for `ephemeroi_settings`, `ephemeroi_sources`, `ephemeroi_observations`, `ephemeroi_beliefs`, `ephemeroi_contradictions`, `ephemeroi_reports`.
- **Real-time Updates**: Server-Sent Events (SSE) stream (`/api/ephemeroi/stream`) for various events including `observation`, `belief`, `contradiction`, `report`, `constellation_alert`.
- **GitHub Source Kind**: First-class support for watching GitHub repositories and user/organization activity.
- **GH Archive Source Kind**: Streams public GitHub event firehose with filtering, designed for efficient, memory-safe processing.
- **Autonomy**: Can autonomously discover and add new GitHub sources based on reflected observations and an LLM judge. **Discovery bar (April 2026):** a candidate is only added if it can be incorporated to further advance Ephemeroi itself — its PHASELOCK-SAT solver, observer/reflection loop, autonomy/discovery layer, theory, or production substrate. Lateral or merely-thematic picks are rejected. Reasons must start with `Advances solver:`, `Advances loop:`, `Advances autonomy:`, or `Advances theory:` (see `discover.ts`).
- **Constellation Alerts**: Per-source 4D state vector (Capability/Integrity/Usability/Trust) that updates with reflections. Reports clearing a threshold trigger Don/Wife/Son narrated alerts via Telegram.
- **Biomimetic Protocol**: Generates and solves a synthetic 3-SAT problem, emitting `constellation_alert` events on significant moments (cage, edict, invariant violation).
- **Self-Improvement**: Reads whitelisted source files, asks `gpt-4o-mini` for patches, validates, applies, and reports via Telegram.
- **Telegram Q&A**: Long-polling loop answers inbound text messages from whitelisted chat IDs using `gpt-4o-mini` with web search, adopting a Don/Wife/Son persona.
- **PDF attachments**: Processes PDF attachments from Telegram, extracts text (capped), and uses it as context for `answerWithWebSearch`.
- **Autonomous topic beliefs**: Extracts and stores `{subject, stance, confidence, evidence}` from Telegram conversations, autonomously mutating belief table.
- **Unified cognitive substrate**: Integrates autonomous topic beliefs, Don/Wife/Son persona, and biomimetic solver into a single closed loop. Features opinion dynamics (reinforcement, blending, flipping), periodic confidence decay modulated by the cognitive field state, and cross-surface coherence in answers via persona-mood injection and prior opinions.

## Theory Document
- **`THEORY.md`** at repo root: standalone PHASELOCK‑SAT writeup — the operational kernel that ties together SCM (physics), Apple Theory (philosophy), and the Prism Architecture. Defines Illumination Density L(A), Phase Mobility ϕ(A), the Expected Apple Descent theorem, the canonical mechanism set, and the Prism planet ↔ SCM mechanism mapping. Authored in the user's voice; do not paraphrase.

## GitHub Mirror
- Project is mirrored to `github.com/ansonScroggins/Ephemeroi` (default branch `main`). Pushes happen via the GitHub connection (`@replit/connectors-sdk`) using the Git Data REST API rather than `git push`, because the main agent's bash sandbox blocks destructive git commands. The original remote `LICENSE` is preserved across snapshot pushes.

## Unified Cross-Site Telegram Stream
- **Shared signal envelope**: Both Ephemeroi and Metacog describe outbound alerts as a `SignalEnvelope` shape.
- **Convergence subscriber**: Buffers envelopes, merging same-subject signals from different limbs within a configurable window into a single Telegram message. Ensures strict single-message-per-pair semantics and handles same-origin burst deduplication.
- **Burst-aware escalation**: Alerts are prefixed with `🚨` based on severity and an exponentially-weighted moving average of burst activity per subject.
- **Inbound endpoint**: `POST /api/ephemeroi/signal` accepts `SignalEnvelope` from external sources.

## UI/UX
- **Metacog**: iMessage-style layout with avatar, live status, and per-step accent colors.
- **Ephemeroi**: React + Vite SPA with overview, sources, beliefs, tensions, reports, and settings pages. Uses generated React Query hooks and dark theme.
- **Visualizations**: Society mode features agent chips with belief bars, influence graphs, reputation matrix, and PCA constellation map. Ephemeroi sources display 4-bar mini-displays for state vectors.

# External Dependencies

- **OpenAI API**: For `gpt-5.2` (or `OPENAI_MODEL`), `text-embedding-3-small` (or `OPENAI_EMBEDDING_MODEL`), and web search (Responses API).
- **Groq API**: Optional fast path for Metacog's Research mode, using `llama-3.3-70b-versatile` (or `GROQ_MODEL`).
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: ORM for PostgreSQL.
- **Zod**: Schema validation.
- **Orval**: OpenAPI specification code generation.
- **`rss-parser`**: For parsing RSS feeds.
- **`@replit/connectors-sdk`**: For GitHub integration authentication and API proxying.
- **Telegram Bot API**: Optional integration for Ephemeroi reports delivery.
- **Ollama**: Optional local LLM for "Don" narration.