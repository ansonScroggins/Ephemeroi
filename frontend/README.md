# Frontend Services

## Overview

The Ephemeroi frontend is organized as a **dual-interface system** serving complementary interaction modes:

- **Metacog** (`/`): Synchronous reasoning interface — user-driven query→response flow with visible reasoning steps
- **Ephemeroi Dashboard** (`/ephemeroi/`): Asynchronous autonomous system — background worldview construction with live telemetry stream

Both interfaces share the same backend infrastructure (database, embeddings, constraint solver) but present fundamentally different UX paradigms.

## Services

### Landing Page (`landing/`)

**Purpose:** Unified entry point explaining the duality of synchronous vs. asynchronous reasoning.

**Route:** `/` (homepage)

**Structure:**
```
landing/
├── index.html          # Single-page HTML + inline CSS/JS
├── styles.css          # (future: extracted for larger project)
└── scripts.js          # (future: extracted event handlers)
```

**Design:**
- Cosmogenesis-inspired typography and motion
- Split-panel layout showing both systems side-by-side
- Animated telemetry stream and belief confidence bars
- CTA cards linking to both interfaces
- Responsive mobile layout

**Styling:**
- Monospace primary font (IBM Plex Mono) with serif display headers
- Color scheme: amber ↔ blue polarity (autonomous ↔ synchronous)
- Noise overlay + scanlines for "instrument panel" aesthetic
- Smooth scroll behavior, animated stream lines, belief bar fill animations

---

### Metacog Interface (TODO)

**Purpose:** Synchronous, real-time reasoning with transparent retrieval lenses.

**Route:** `/`

**Planned features:**
- 4-lens retrieval system (VISIBLE, INFRARED, UV, PRISM)
- Browser localStorage déjà vu memory
- Real-time reasoning posture display
- Query history and context carryover

---

### Ephemeroi Dashboard (TODO)

**Purpose:** Autonomous background system with persistent belief evolution.

**Route:** `/ephemeroi/`

**Planned features:**
- Live telemetry stream rendering
- Belief confidence tracker
- Tension/conflict visualization
- Report dispatch notifications (Telegram)
- Feed subscription management

---

## Backend Integration Points

### Expected API Endpoints

```
POST   /api/query                    # Metacog: synchronous reasoning request
GET    /api/query/:id/stream         # Metacog: reasoning stream (SSE)
GET    /api/memory/similar           # Metacog: déjà vu retrieval
POST   /api/feeds                    # Ephemeroi: subscribe to feed
GET    /api/beliefs                  # Ephemeroi: current belief state
GET    /api/beliefs/stream           # Ephemeroi: belief updates (SSE)
GET    /api/telemetry                # Ephemeroi: raw telemetry stream
```

### Database Schema (Proposed)

```sql
-- Metacog session memory
CREATE TABLE query_sessions (
  id UUID PRIMARY KEY,
  user_id UUID,
  query TEXT,
  reasoning_steps JSONB,
  final_answer TEXT,
  belief_confidence FLOAT,
  created_at TIMESTAMP
);

-- Ephemeroi belief store
CREATE TABLE beliefs (
  id UUID PRIMARY KEY,
  statement TEXT,
  confidence FLOAT,
  sources JSONB,
  tension_with_id UUID,
  last_updated TIMESTAMP,
  created_at TIMESTAMP
);

-- Autonomous feed subscriptions
CREATE TABLE feeds (
  id UUID PRIMARY KEY,
  url TEXT,
  poll_interval_minutes INT,
  last_polled TIMESTAMP,
  created_at TIMESTAMP
);

-- Telemetry events
CREATE TABLE telemetry_events (
  id UUID PRIMARY KEY,
  event_type TEXT,
  payload JSONB,
  timestamp TIMESTAMP
);
```

---

## Deployment Structure

```
frontend/
├── landing/
│   └── index.html                  # Landing page (this file)
│
├── metacog/                        # (TODO) Synchronous React app
│   ├── public/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── QueryInput.tsx
│   │   │   ├── ReasoningStream.tsx
│   │   │   └── LensPanel.tsx
│   │   └── hooks/
│   │       └── useDejaVu.ts
│   └── package.json
│
├── ephemeroi-dashboard/            # (TODO) Autonomous React app
│   ├── public/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── BeliefTracker.tsx
│   │   │   ├── TelemetryStream.tsx
│   │   │   ├── TensionGraph.tsx
│   │   │   └── FeedManager.tsx
│   │   └── hooks/
│   │       ├── useBelievStream.ts
│   │       └── useTelemetry.ts
│   └── package.json
│
├── shared/                         # (TODO) Common utilities
│   ├── api.ts                      # API client
│   ├── types.ts                    # TypeScript interfaces
│   └── utils/
│       └── embedding.ts            # Embedding helpers
│
└── README.md (this file)
```

---

## Development Roadmap

### Phase 1: Landing Page ✅
- Static HTML landing page explaining duality
- Links to both interfaces (initially dead links)

### Phase 2: Metacog
- React app with query interface
- Backend integration for synchronous reasoning
- Memory layer (localStorage → server storage)
- Lens visualization

### Phase 3: Ephemeroi Dashboard
- React app with belief/telemetry display
- Backend autonomous loop
- Feed polling service
- Telegram notifications

### Phase 4: Unification
- Shared session layer
- Cross-interface context passing
- Unified authentication

---

## Design Language

### Color Palette
- **Blue (#4a90d9)**: Synchronous, cognitive, user-driven
- **Amber (#d4a24c)**: Autonomous, energetic, background process
- **Green (#3eb489)**: Operational, active, pulse indicator
- **Red (#c25f5f)**: Conflict, tension, alert state

### Typography
- **Display**: Bebas Neue — wordmarks, section headers
- **Body**: IBM Plex Mono — technical content, data, interface labels
- **Serif**: DM Serif Display — italic headline emphasis

### Motion
- **Pulse animation**: 2s ease-in-out (green dot, deja vu indicator)
- **Stream fade-in**: Staggered 0.2s intervals per line
- **Belief bar fill**: 0.6s ease transition
- **Hover effects**: 0.2-0.3s color/background transitions

---

## CSS Architecture

All styles are inline in `landing/index.html` using CSS variables (`:root`). This keeps the landing page self-contained as a single file.

For future growth:
- Extract styles into `styles.css`
- Use CSS Modules or Tailwind for component-scoped styling in React apps
- Maintain color variable consistency across all apps

---

## Scripts

Current inline JavaScript handles:
- Stream animation restart on viewport intersection
- Belief bar fill animation on page load

Future:
- React/TypeScript for all interactive interfaces
- Server-side rendering for landing page (optional)
- WebSocket integration for live telemetry streams

---

## Notes

**Why landing page is single HTML file:**
- Zero deployment friction (serve as static asset)
- Self-contained, no build step needed
- Fast load time
- Easy to modify design without rebuilding

**Why Metacog & Ephemeroi are separate React apps:**
- Distinct interaction paradigms (sync vs. async)
- Independent state management
- Easier to reason about complexity
- Can be deployed/scaled separately

**Shared substrate philosophy:**
- One backend instance
- One database
- One embeddings service
- Two frontend interfaces
- Architecturally siblings, conceptually complementary

