import { useCallback, useRef, useState } from "react";

export interface SocietyAgent {
  id: string;
  name: string;
  color: string;
  archetype: string;
  traits: { skepticism: number; conformity: number; curiosity: number; persuasiveness: number };
  belief: number;
  agitator: boolean;
}

export interface SocietyStatement {
  round: number;
  agentId: string;
  text: string;
  valence: number;
  target: string | null;
}

export interface SocietyInfluence {
  round: number;
  from: string;
  to: string;
  weight: number;
  direction: "up" | "down";
}

export interface SocietyNarrator {
  phase: "midway" | "final";
  round: number;
  text: string;
}

export interface SocietyClusterPosition {
  agentId: string;
  x: number;
  y: number;
}

/**
 * End-of-round snapshot used by the replay scrubber. We snapshot when a
 * `cluster_positions` event arrives, since by that point all of that
 * round's belief / reputation / influence / feed events have already been
 * applied to the live state.
 */
export interface SocietyRoundSnapshot {
  round: number;
  beliefs: Record<string, number>;
  reputation: Record<string, Record<string, number>>;
  clusterPositions: SocietyClusterPosition[];
  /** Length of `feed` array immediately after this round was applied. */
  feedLength: number;
  /** Length of `influences` array immediately after this round was applied. */
  influencesLength: number;
}

export interface SocietyState {
  topic: string;
  rounds: number;
  includeAgitator: boolean;
  agents: SocietyAgent[];
  /** current belief per agentId */
  beliefs: Record<string, number>;
  /** trust matrix: reputation[listener][speaker] = 0..1 */
  reputation: Record<string, Record<string, number>>;
  /** per-round events for debate feed (in arrival order) */
  feed: Array<
    | { kind: "round_start"; round: number }
    | { kind: "world_event"; round: number; text: string }
    | { kind: "statement"; round: number; agentId: string; text: string; valence: number; target: string | null }
    | { kind: "narrator"; round: number; phase: "midway" | "final"; text: string }
  >;
  /** all influence edges (used to draw the graph; weights aggregated) */
  influences: SocietyInfluence[];
  /** latest 2D PCA projection of belief vectors per agent */
  clusterPositions: SocietyClusterPosition[];
  /** which round the latest clusterPositions came from (0 = pre-round-1 init) */
  clusterRound: number;
  currentRound: number;
  /** End-of-round snapshots keyed by round number, in arrival order. */
  roundSnapshots: SocietyRoundSnapshot[];
  provider?: string;
  model?: string;
  done: boolean;
  error?: string;
}

const empty: SocietyState = {
  topic: "",
  rounds: 0,
  includeAgitator: false,
  agents: [],
  beliefs: {},
  reputation: {},
  feed: [],
  influences: [],
  clusterPositions: [],
  clusterRound: 0,
  currentRound: 0,
  roundSnapshots: [],
  done: false,
};

export interface StartSocietyOptions {
  topic: string;
  rounds?: number;
  includeAgitator?: boolean;
}

export function useSocietyStream() {
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<SocietyState>(empty);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (opts: StartSocietyOptions) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsRunning(true);
    setState({ ...empty, topic: opts.topic, rounds: opts.rounds ?? 5, includeAgitator: !!opts.includeAgitator });

    try {
      const resp = await fetch("/api/society/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: opts.topic,
          rounds: opts.rounds ?? 5,
          includeAgitator: !!opts.includeAgitator,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        const errorText = await resp.text().catch(() => "Unknown error");
        setState((s) => ({ ...s, error: `Request failed: ${errorText}` }));
        setIsRunning(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setIsRunning(false);
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt["done"] === true) {
            setIsRunning(false);
            setState((s) => ({ ...s, done: true }));
            continue;
          }
          handleEvent(evt, setState);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : "Simulation failed" }));
      setIsRunning(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  return { state, isRunning, start, stop };
}

function handleEvent(evt: Record<string, unknown>, setState: React.Dispatch<React.SetStateAction<SocietyState>>) {
  const t = evt["type"];
  setState((s) => {
    if (t === "started") {
      const agents = (evt["agents"] as SocietyAgent[]) ?? [];
      const beliefs = Object.fromEntries(agents.map((a) => [a.id, a.belief]));
      const reputation: Record<string, Record<string, number>> = {};
      for (const a of agents) {
        reputation[a.id] = {};
        for (const b of agents) if (a.id !== b.id) reputation[a.id]![b.id] = 0.5;
      }
      return {
        ...s,
        agents,
        beliefs,
        reputation,
        provider: evt["provider"] as string | undefined,
        model: evt["model"] as string | undefined,
      };
    }
    if (t === "round_start") {
      const round = evt["round"] as number;
      return { ...s, currentRound: round, feed: [...s.feed, { kind: "round_start", round }] };
    }
    if (t === "world_event") {
      return {
        ...s,
        feed: [...s.feed, { kind: "world_event", round: evt["round"] as number, text: evt["text"] as string }],
      };
    }
    if (t === "statement") {
      return {
        ...s,
        feed: [
          ...s.feed,
          {
            kind: "statement",
            round: evt["round"] as number,
            agentId: evt["agentId"] as string,
            text: evt["text"] as string,
            valence: evt["valence"] as number,
            target: (evt["target"] as string | null) ?? null,
          },
        ],
      };
    }
    if (t === "belief_update") {
      const agentId = evt["agentId"] as string;
      const after = evt["after"] as number;
      return { ...s, beliefs: { ...s.beliefs, [agentId]: after } };
    }
    if (t === "reputation_update") {
      const listener = evt["agentId"] as string;
      const speaker = evt["towards"] as string;
      const after = evt["after"] as number;
      return {
        ...s,
        reputation: {
          ...s.reputation,
          [listener]: { ...(s.reputation[listener] ?? {}), [speaker]: after },
        },
      };
    }
    if (t === "influence") {
      return {
        ...s,
        influences: [
          ...s.influences,
          {
            round: evt["round"] as number,
            from: evt["from"] as string,
            to: evt["to"] as string,
            weight: evt["weight"] as number,
            direction: (evt["direction"] as "up" | "down") ?? "up",
          },
        ],
      };
    }
    if (t === "cluster_positions") {
      const positionsRaw = (evt["positions"] as SocietyClusterPosition[] | undefined) ?? [];
      const round = (evt["round"] as number | undefined) ?? s.clusterRound;
      // Snapshot end-of-round state for the replay scrubber. Replace any
      // existing snapshot for the same round (defensive against re-emits).
      const snapshot: SocietyRoundSnapshot = {
        round,
        beliefs: { ...s.beliefs },
        reputation: Object.fromEntries(
          Object.entries(s.reputation).map(([k, v]) => [k, { ...v }]),
        ),
        clusterPositions: positionsRaw,
        feedLength: s.feed.length,
        influencesLength: s.influences.length,
      };
      const filtered = s.roundSnapshots.filter((snap) => snap.round !== round);
      const nextSnapshots = [...filtered, snapshot].sort(
        (a, b) => a.round - b.round,
      );
      return {
        ...s,
        clusterPositions: positionsRaw,
        clusterRound: round,
        roundSnapshots: nextSnapshots,
      };
    }
    if (t === "narrator") {
      const round = evt["round"] as number;
      const nextFeed: SocietyState["feed"] = [
        ...s.feed,
        {
          kind: "narrator",
          round,
          phase: evt["phase"] as "midway" | "final",
          text: evt["text"] as string,
        },
      ];
      // Narrator beats can arrive AFTER cluster_positions for the same round
      // (midway and final narrators are emitted after the per-round PCA
      // event). Backfill any existing snapshot for this round so the replay
      // scrubber includes the narrator in that round's transcript.
      const nextSnapshots = s.roundSnapshots.map((snap) =>
        snap.round === round
          ? { ...snap, feedLength: nextFeed.length }
          : snap,
      );
      return {
        ...s,
        feed: nextFeed,
        roundSnapshots: nextSnapshots,
      };
    }
    if (t === "complete") {
      return { ...s, done: true };
    }
    if (t === "error") {
      return { ...s, error: evt["message"] as string };
    }
    return s;
  });
}
