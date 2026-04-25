# Frontend Services

Ephemeroi's user-facing layer is split into two complementary interfaces:

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Landing Page (Static HTML)                                  │
│ Entry point · system overview · modal dispatch              │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       │                               │
┌──────▼────────┐           ┌──────────▼──────┐
│ METACOG       │           │ EPHEMEROI       │
│ Synchronous   │           │ Autonomous      │
│ React App     │           │ React App       │
│ [PORT 3000]   │           │ [PORT 3001]     │
└───────┬───────┘           └────────┬────────┘
        │                           │
        └──────────────┬────────────┘
                       │
        ┌──────────────▼───────────────┐
        │  Shared Backend (Node/Python) │
        │  ├─ OpenAI Integration        │
        │  ├─ Vector DB (Pinecone)      │
        │  ├─ LLM Streaming             │
        │  └─ Belief State Management   │
        └──────────────────────────────┘
```

## Services

### 1. Landing Page (`/frontend/landing/`)

**Status:** ✅ Live  
**Entry Point:** `index.html`  
**Tech:** Pure HTML + inline CSS + vanilla JS  
**Ports:** Static serve (GitHub Pages or `http-server`)

The landing page is the system's portal. It introduces the dual-interface concept and provides navigation to both Metacog and Ephemeroi.

**Features:**
- Split-panel design (Metacog left, Ephemeroi right)
- Animated telemetry stream mockup
- Belief confidence bar visualizations
- Lens pill system (Visible, Infrared, UV, Prism)
- Déjà vu memory preview (localStorage demo)
- CTA cards linking to full applications
- Cosmogenesis aesthetic: noise overlay, scanlines, amber/blue polarity

**Deploy:**
```bash
cd frontend/landing
python -m http.server 8000
# Open http://localhost:8000
```

Or serve as static site on GitHub Pages / Vercel / Netlify.

---

### 2. METACOG (`/frontend/metacog/`) [Phase 2]

**Status:** Planned  
**Type:** React SPA  
**Port:** 3000  
**Mode:** Synchronous, user-driven  

Metacog is the **interactive reasoning interface**. You ask it a question, and it thinks out loud using four retrieval lenses:

- **VISIBLE**: Get initial bearings from recent/relevant sources
- **INFRARED**: First-principles derivation; go back to axioms
- **UV**: Verify existing claims against contradicting evidence
- **PRISM**: Oblique pivot; find adjacent problem framings

**Planned Features:**
- Real-time lens visualization during retrieval
- Belief update animations as confidence scores change
- Déjà vu memory: localStorage-based previous query surface
- Streaming response with visible chain-of-thought
- Exportable reasoning traces
- Browser localStorage for session persistence

**Architecture:**
- React functional components with hooks
- Zustand for state management
- Streaming fetch API to backend
- WebSocket for real-time telemetry overlay
- TailwindCSS + custom cosmogenesis theme

---

### 3. EPHEMEROI (`/frontend/ephemeroi/`) [Phase 2]

**Status:** Planned  
**Type:** React SPA  
**Port:** 3001  
**Mode:** Asynchronous, autonomous  

Ephemeroi is the **worldview-building dashboard**. You configure feeds and topics, then check back in. The system runs autonomously, embedding new material, detecting tensions, and flagging importance.

**Planned Features:**
- Belief state visualization (confidence bars, contradiction flags)
- Live reflection stream with tagged events ([SYS], [IMP], [BEL ↑], [TENSION])
- Importance threshold crossing → Telegram notification
- Fragment graph visualization (sub-agents and their orientations)
- Backbone lock status display
- Historical trajectory: how beliefs evolved over time
- Export beliefs as JSON or markdown

**Architecture:**
- React functional components
- Zustand for persistent state
- WebSocket connection to autonomous backend (long-polling fallback)
- Chart.js for historical belief trajectories
- Same cosmogenesis design as landing page

---

## Backend API Surface

Both frontends consume a shared backend API:

### Metacog Endpoints

```
POST /api/metacog/query
  {
    question: string
    lenses: ["VISIBLE", "INFRARED", "UV", "PRISM"]
    streaming: true
  }
  → EventStream (SSE or chunked response)

GET /api/metacog/memory
  → { queries: Query[], recent_beliefs: Belief[] }

POST /api/metacog/memory/save
  { reasoning_trace: object, conclusion: string }
  → { id, timestamp }

GET /api/metacog/memory/:id
  → Previous query + reasoning trace
```

### Ephemeroi Endpoints

```
GET /api/ephemeroi/state
  → {
      beliefs: Belief[],
      tensions: Tension[],
      fragments: Fragment[],
      telemetry: Telemetry
    }

POST /api/ephemeroi/feeds
  { url: string, topic: string }
  → { feed_id, status }

GET /api/ephemeroi/feeds
  → Feed[]

DELETE /api/ephemeroi/feeds/:id
  → { status: "deleted" }

WebSocket /ws/ephemeroi/telemetry
  → Real-time stream of belief updates, tensions, reflections

GET /api/ephemeroi/beliefs/history
  ?variable=name&days=7
  → Historical confidence trajectory
```

---

## Database Schema (Proposed)

### Metacog Tables

```sql
-- Previous queries and reasoning traces
CREATE TABLE metacog_queries (
  id UUID PRIMARY KEY,
  question TEXT,
  lenses TEXT[],
  reasoning_trace JSONB,
  conclusion TEXT,
  model_version VARCHAR,
  created_at TIMESTAMP,
  user_id UUID,
  tags TEXT[]
);

-- Lens performance metrics
CREATE TABLE metacog_lens_evals (
  id UUID PRIMARY KEY,
  query_id UUID REFERENCES metacog_queries,
  lens_name VARCHAR,
  sources_retrieved INT,
  quality_score FLOAT,
  time_ms INT,
  created_at TIMESTAMP
);
```

### Ephemeroi Tables

```sql
-- Belief state
CREATE TABLE ephemeroi_beliefs (
  id UUID PRIMARY KEY,
  variable_name TEXT,
  confidence FLOAT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  evidence JSONB,
  tier VARCHAR,
  user_id UUID
);

-- Tension detection
CREATE TABLE ephemeroi_tensions (
  id UUID PRIMARY KEY,
  belief_a_id UUID,
  belief_b_id UUID,
  conflict_score FLOAT,
  detected_at TIMESTAMP,
  resolved BOOLEAN,
  resolution_note TEXT
);

-- Feed configuration
CREATE TABLE ephemeroi_feeds (
  id UUID PRIMARY KEY,
  url TEXT,
  topic TEXT,
  fetch_interval_minutes INT DEFAULT 5,
  last_fetch TIMESTAMP,
  item_count INT,
  user_id UUID
);

-- Embedded items
CREATE TABLE ephemeroi_items (
  id UUID PRIMARY KEY,
  feed_id UUID REFERENCES ephemeroi_feeds,
  title TEXT,
  content TEXT,
  embedding VECTOR(1536),
  importance_score FLOAT,
  embedded_at TIMESTAMP,
  mentioned_beliefs TEXT[]
);

-- Telemetry stream
CREATE TABLE ephemeroi_telemetry (
  id UUID PRIMARY KEY,
  event_type VARCHAR,
  event_data JSONB,
  timestamp TIMESTAMP
);
```

---

## Design Language

### Color Palette

- **--bg**: `#080a0d` (near-black base)
- **--surface**: `#0d1117` (card/container tint)
- **--border**: `#1e2530` (prominent grid lines)
- **--border-dim**: `#141820` (subtle dividers)
- **--text**: `#c8d0dc` (body text)
- **--text-dim**: `#56636e` (secondary text)
- **--text-faint**: `#2a3340` (tertiary, labels)
- **--blue**: `#4a90d9` (Metacog primary)
- **--amber**: `#d4a24c` (Ephemeroi primary)
- **--green**: `#3eb489` (system active pulse)
- **--red**: `#c25f5f` (tension/conflict)

### Typography

- **Display**: Bebas Neue (large headings, impact)
- **Serif**: DM Serif Display (dramatic italics, subtitles)
- **Mono**: IBM Plex Mono (data, code, telemetry)

### Effects

- **Noise overlay**: SVG fBm fractal noise at 0.04 opacity (cosmic grain)
- **Scanlines**: Repeating 2-4px horizontal grain at 0.03 opacity
- **Pulse animation**: Green dot oscillates with 2s cycle, halo expands then contracts
- **Fade-in cascade**: Stream lines stagger in at 0.8s intervals
- **Glow on hover**: Radial gradient brightens panel backgrounds

---

## Development Roadmap

### Phase 1: Landing (✅ Complete)
- Static landing page with visual mockups
- Dual-interface framing
- Navigation structure

### Phase 2: MVP Frontends
- React scaffolding for Metacog and Ephemeroi
- Backend API stub + database schema
- Streaming integration for queries
- WebSocket telemetry for Ephemeroi

### Phase 3: Belief Engine
- Photanic Chip integration → Belief state management
- Tension detection algorithm
- Déjà vu memory surface
- Fragment graph visualization

### Phase 4: Polish + Expansion
- Export/share reasoning traces
- Dark/light theme toggle
- Mobile responsiveness refinement
- Telegram notification integration

---

## Running Locally

**Prerequisite:** Node.js 16+, Python 3.8+

```bash
# 1. Start landing page (static)
cd frontend/landing
python -m http.server 8000
# http://localhost:8000

# 2. Start backend (placeholder)
cd backend
pip install -r requirements.txt
python app.py
# http://localhost:5000

# 3. Start Metacog (when scaffolded)
cd frontend/metacog
npm install
npm run dev
# http://localhost:3000

# 4. Start Ephemeroi (when scaffolded)
cd frontend/ephemeroi
npm install
npm run dev
# http://localhost:3001
```

All services will be accessible via localhost with a shared backend.

---

## Cosmological Isomorphism in Design

The frontend layout mirrors the Ephemeroi solver architecture:

| Physical/Mathematical | Design Element |
|---|---|
| Universe bifurcation (Belief/Reality) | Metacog ↔ Ephemeroi split panels |
| Phase field Φ(t) visualization | Streaming telemetry + bar charts |
| Vacuum pressure V(σ, F) | Color intensity, glow, tension indicators |
| Backbone crystallization | Belief confidence bars filling |
| Basin entrapment | Tension flags when beliefs conflict |
| Cosmological arrows | Time-indexed history, trajectory plots |

The UI is not decoration. It is a live rendering of the solver's state.
