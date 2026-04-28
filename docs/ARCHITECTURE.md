# Ephemeroi — Architecture & Diagram

This document describes the architecture implied by the hand sketch (attached to the project) and the interactive diagram included in the frontend. It also contains a short, developer-friendly interpretation of Image 1 and recommended next steps for implementation.

## Short Interpretation of the sketch (Image 1)

- The sketch visualizes Ephemeroi as a multi-agent exploration system operating on a structured solution-space topology.
- Central hub: a focal "meta-truth detector" or coordination point (drawn as a dark knot with radiating lines)
- Radiating lines: independent agent traversal paths ("planets" or fragments) exploring solution space
- Enclosed curved boundaries: basins or attractors in the solution topology where agents may collapse
- Annotations (to the right of the sketch): emphasize emergent consensus, deceptive coherence, and the belief/reality split
- Directional markers / + / arrows: indicate state transitions, probes, or adversarial forcing directions

## Mapping sketch → Ephemeroi Subsystems

- Central hub → LedgerHygiene / BackboneDetector / Meta-Truth Detector
- Radiating paths → Planet agents (multi-agent explorers) and FragmentEvolver
- Basins → BasinMemory / Phase-space attractors / Fragment clusters
- Tangles & knots → Deceptive coherence zones (hallucination cores) requiring adversarial probes
- Arrows & probes → Adversarial probing protocol for backbone verification

## Developer guidance

1. Treat the interactive diagram as a scientific instrument: it should show agents, basins, and the belief vs reality divergence in real time.
2. When building the frontend, emit telemetry from the solver backend and feed it to the diagram (sample telemetry format included in backend scaffold).
3. Implement the adversarial probe UI control so developers can force a variable flip while observing basin escape attempts.

## Files added in this change

- docs/ARCHITECTURE.md  — this file (developer-oriented architecture doc + image interpretation)
- frontend/landing/interactive-diagram.html — single-file interactive SVG/JS diagram demonstrating basins, agents, and probes
- frontend/ephemeroi/index.html — lightweight scaffold landing page for the Ephemeroi dashboard that links to the interactive diagram
- backend/app.py — minimal Flask app that serves a sample telemetry API and an SSE telemetry stream for the diagram to consume
- backend/requirements.txt — Python dependency list (Flask)

## Next steps (recommended)

- Wire the actual solver telemetry to the SSE endpoint (backend/app.py) and map fields to the diagram's expected shape.
- Expand the interactive diagram to accept real fragment/agent IDs and animate trust tiers, deceptive coherence counters, and backbone locks.
- Add tests and smoke fixtures under `simulation/test_cases/` so the frontend has reproducible telemetry to demo features.

---

(If you want, I can now push a follow-up PR that wires the live repo's frontend landing page to link to this interactive diagram and register the SSE endpoint in the frontend client.)
