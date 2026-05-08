import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type {
  SocietyState,
  SocietyAgent,
  SocietyClusterPosition,
  SocietyInfluence,
} from "@/hooks/use-society-stream";
import {
  AlertTriangle,
  Sparkles,
  Globe2,
  Users,
  Network,
  Telescope,
  Play,
  Pause,
  Rewind,
} from "lucide-react";

interface SocietyViewProps {
  state: SocietyState;
  isRunning: boolean;
}

/**
 * Effective view of state at a given playback round, or live if
 * `playbackRound` is null.
 */
interface EffectiveView {
  beliefs: Record<string, number>;
  reputation: Record<string, Record<string, number>>;
  clusterPositions: SocietyClusterPosition[];
  clusterRound: number;
  feed: SocietyState["feed"];
  influences: SocietyInfluence[];
  /** True when we are scrubbing through a past round (not live). */
  scrubbing: boolean;
}

function deriveEffective(
  state: SocietyState,
  playbackRound: number | null,
): EffectiveView {
  if (playbackRound === null) {
    return {
      beliefs: state.beliefs,
      reputation: state.reputation,
      clusterPositions: state.clusterPositions,
      clusterRound: state.clusterRound,
      feed: state.feed,
      influences: state.influences,
      scrubbing: false,
    };
  }
  const snap = state.roundSnapshots.find((s) => s.round === playbackRound);
  if (!snap) {
    return {
      beliefs: state.beliefs,
      reputation: state.reputation,
      clusterPositions: state.clusterPositions,
      clusterRound: state.clusterRound,
      feed: state.feed,
      influences: state.influences,
      scrubbing: false,
    };
  }
  return {
    beliefs: snap.beliefs,
    reputation: snap.reputation,
    clusterPositions: snap.clusterPositions,
    clusterRound: snap.round,
    feed: state.feed.slice(0, snap.feedLength),
    influences: state.influences.slice(0, snap.influencesLength),
    scrubbing: true,
  };
}

export function SocietyView({ state, isRunning }: SocietyViewProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [playbackRound, setPlaybackRound] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Whenever a new sim starts (agents reset), drop playback back to live.
  const agentsKey = state.agents.map((a) => a.id).join(",");
  useEffect(() => {
    setPlaybackRound(null);
    setIsPlaying(false);
  }, [agentsKey]);

  // While the sim is still streaming, force live view; the scrubber only
  // unlocks after the run finishes.
  useEffect(() => {
    if (isRunning) {
      setPlaybackRound(null);
      setIsPlaying(false);
    }
  }, [isRunning]);

  const snapshots = state.roundSnapshots;
  const minRound = snapshots[0]?.round ?? 0;
  const maxRound = snapshots[snapshots.length - 1]?.round ?? 0;

  // Auto-advance during play. 600ms matches the constellation transition.
  useEffect(() => {
    if (!isPlaying) return;
    if (snapshots.length < 2) {
      setIsPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setPlaybackRound((current) => {
        const start = current ?? minRound;
        if (start >= maxRound) {
          setIsPlaying(false);
          return null; // jump back to live at the end
        }
        // Find the next available snapshot round (snapshots may be sparse).
        const next = snapshots.find((s) => s.round > start);
        if (!next) {
          setIsPlaying(false);
          return null;
        }
        return next.round;
      });
    }, 600);
    return () => window.clearInterval(id);
  }, [isPlaying, snapshots, minRound, maxRound]);

  const effective = useMemo(
    () => deriveEffective(state, playbackRound),
    [state, playbackRound],
  );

  // Auto-scroll feed (only when live; while scrubbing we want to see the
  // statements at that round, not snap to the bottom).
  useEffect(() => {
    if (!feedRef.current) return;
    if (effective.scrubbing) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [effective.feed.length, effective.scrubbing]);

  const handleScrub = useCallback(
    (round: number) => {
      setIsPlaying(false);
      // Snap to nearest snapshot round (snapshots are guaranteed sorted).
      if (snapshots.length === 0) return;
      let nearest = snapshots[0]!;
      let nearestDist = Math.abs(nearest.round - round);
      for (const s of snapshots) {
        const d = Math.abs(s.round - round);
        if (d < nearestDist) {
          nearest = s;
          nearestDist = d;
        }
      }
      // Always lock to the explicit snapshot — never auto-coerce to live
      // when the user scrubs to maxRound. "Live" is reserved for the
      // explicit Live button (or an in-progress sim).
      setPlaybackRound(nearest.round);
    },
    [snapshots],
  );

  const handleTogglePlay = useCallback(() => {
    if (snapshots.length < 2) return;
    setIsPlaying((p) => {
      const next = !p;
      // If we're at the end (or live) and starting playback, rewind to start.
      if (next && (playbackRound === null || playbackRound >= maxRound)) {
        setPlaybackRound(minRound);
      }
      return next;
    });
  }, [snapshots.length, playbackRound, minRound, maxRound]);

  const handleRewind = useCallback(() => {
    if (snapshots.length === 0) return;
    setIsPlaying(false);
    setPlaybackRound(minRound);
  }, [snapshots, minRound]);

  const handleLive = useCallback(() => {
    setIsPlaying(false);
    setPlaybackRound(null);
  }, []);

  if (state.agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-md flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
            <Users className="h-7 w-7 text-white" />
          </div>
          <div className="text-lg font-semibold">Run a society sim</div>
          <div className="text-sm text-muted-foreground leading-relaxed">
            Pick a topic. I'll spin up four agents with different personalities, let them debate over a few rounds, and watch how their beliefs (and trust in each other) shift. Toggle <span className="text-rose-400 font-medium">⚠ agitator</span> to drop in a misinformation campaigner and see who gets captured.
          </div>
          <div className="text-[11px] text-muted-foreground/70 italic">
            Try: "remote work productivity", "AI regulation", "EVs vs hybrids", "the four-day workweek"
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col" data-testid="society-view">
      {/* Top: agents row */}
      <AgentsRow state={state} effective={effective} />

      {/* Middle: split — debate feed | influence graph */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-2 px-2 pb-2 min-h-0">
        <DebateFeed
          state={state}
          effective={effective}
          feedRef={feedRef}
          isRunning={isRunning}
        />
        <SidePanel state={state} effective={effective} />
      </div>

      {/* Bottom: round scrubber (only after a sim completes with ≥2 snapshots) */}
      {!isRunning && snapshots.length >= 2 && (
        <RoundScrubber
          minRound={minRound}
          maxRound={maxRound}
          snapshotRounds={snapshots.map((s) => s.round)}
          playbackRound={playbackRound}
          isPlaying={isPlaying}
          onScrub={handleScrub}
          onTogglePlay={handleTogglePlay}
          onRewind={handleRewind}
          onLive={handleLive}
        />
      )}
    </div>
  );
}

function RoundScrubber({
  minRound,
  maxRound,
  snapshotRounds,
  playbackRound,
  isPlaying,
  onScrub,
  onTogglePlay,
  onRewind,
  onLive,
}: {
  minRound: number;
  maxRound: number;
  snapshotRounds: number[];
  playbackRound: number | null;
  isPlaying: boolean;
  onScrub: (round: number) => void;
  onTogglePlay: () => void;
  onRewind: () => void;
  onLive: () => void;
}) {
  // When playbackRound is null we're on "live" — show the slider at maxRound.
  const sliderValue = playbackRound ?? maxRound;
  const span = Math.max(1, maxRound - minRound);
  return (
    <div
      className="border-t border-border/40 bg-card/50 px-3 py-2 flex items-center gap-3"
      data-testid="round-scrubber"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onRewind}
          className="h-7 w-7 rounded-md bg-muted/40 hover:bg-muted/60 border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Rewind to round ${minRound}`}
          data-testid="scrubber-rewind"
        >
          <Rewind className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          className={cn(
            "h-7 w-7 rounded-md border flex items-center justify-center transition-colors",
            isPlaying
              ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
              : "bg-muted/40 hover:bg-muted/60 border-border/40 text-muted-foreground hover:text-foreground",
          )}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          data-testid="scrubber-play"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono shrink-0">
          round
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={minRound}
            max={maxRound}
            step={1}
            value={sliderValue}
            onChange={(e) => onScrub(Number(e.target.value))}
            className="w-full accent-violet-500 cursor-pointer"
            aria-label="Scrub through rounds"
            data-testid="scrubber-slider"
          />
          {/* Tick marks for each snapshot */}
          <div className="absolute inset-x-0 -bottom-1.5 flex items-center pointer-events-none px-[2px]">
            {snapshotRounds.map((r) => (
              <span
                key={r}
                className="block h-1 w-px bg-border/60"
                style={{
                  marginLeft:
                    r === minRound ? 0 : `calc(${((r - minRound) / span) * 100}% - ${((r - minRound) / span) * 4}px)`,
                  position: "absolute",
                  left: `calc(${((r - minRound) / span) * 100}%)`,
                }}
              />
            ))}
          </div>
        </div>
        <span
          className="text-[11px] font-mono tabular-nums text-foreground/90 shrink-0 w-20 text-right"
          data-testid="scrubber-label"
        >
          {playbackRound === null ? (
            <span className="text-emerald-400">live · r{maxRound}</span>
          ) : (
            <>
              r{playbackRound}
              <span className="text-muted-foreground/60"> / {maxRound}</span>
            </>
          )}
        </span>
        {playbackRound !== null && (
          <button
            type="button"
            onClick={onLive}
            className="text-[10px] uppercase tracking-widest font-mono px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition-colors shrink-0"
            data-testid="scrubber-live"
          >
            live
          </button>
        )}
      </div>
    </div>
  );
}

function AgentsRow({ state, effective }: { state: SocietyState; effective: EffectiveView }) {
  return (
    <div className="px-3 pt-2 pb-2 border-b border-border/40 bg-card/40">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
        <Users className="h-3 w-3" /> agents
        <span className="text-muted-foreground/50">·</span>
        <span className="text-foreground/80 normal-case tracking-normal font-sans">
          topic: <span className="text-primary">"{state.topic}"</span>
        </span>
        {state.includeAgitator && (
          <span className="ml-auto inline-flex items-center gap-1 text-rose-400 normal-case tracking-normal font-sans">
            <AlertTriangle className="h-3 w-3" /> misinformation campaign active
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {state.agents.map((a) => (
          <AgentChip key={a.id} agent={a} belief={effective.beliefs[a.id] ?? a.belief} />
        ))}
      </div>
    </div>
  );
}

function AgentChip({ agent, belief }: { agent: SocietyAgent; belief: number }) {
  // belief from -1..1 -> bar fill 0..100% with center at 50%
  const fill = Math.round(((belief + 1) / 2) * 100);
  const initial = agent.name[0]?.toUpperCase() ?? "?";
  return (
    <div
      className={cn(
        "shrink-0 w-32 rounded-2xl px-2.5 py-2 border transition-colors",
        agent.agitator
          ? "bg-rose-500/10 border-rose-500/40"
          : "bg-muted/30 border-border/40"
      )}
      data-testid={`agent-chip-${agent.id}`}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-slate-950 shrink-0"
          style={{ backgroundColor: agent.color }}
        >
          {initial}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-[12px] font-semibold truncate flex items-center gap-1">
            {agent.name}
            {agent.agitator && <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />}
          </div>
          <div className="text-[9px] text-muted-foreground truncate" title={agent.archetype}>
            {agent.archetype}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between text-[9px] text-muted-foreground font-mono">
          <span>against</span>
          <span className="text-foreground" data-testid={`agent-belief-${agent.id}`}>
            {belief >= 0 ? "+" : ""}
            {belief.toFixed(2)}
          </span>
          <span>for</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-muted/60 overflow-hidden mt-0.5">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/80" />
          <div
            className="absolute inset-y-0 transition-all duration-500"
            style={{
              backgroundColor: agent.color,
              left: belief < 0 ? `${fill}%` : "50%",
              right: belief < 0 ? "50%" : `${100 - fill}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DebateFeed({
  state,
  effective,
  feedRef,
  isRunning,
}: {
  state: SocietyState;
  effective: EffectiveView;
  feedRef: React.RefObject<HTMLDivElement | null>;
  isRunning: boolean;
}) {
  const agentsById = useMemo(() => Object.fromEntries(state.agents.map((a) => [a.id, a])), [state.agents]);

  return (
    <div
      ref={feedRef}
      className={cn(
        "overflow-y-auto rounded-xl bg-card/30 border p-3 flex flex-col gap-2 min-h-0",
        effective.scrubbing ? "border-violet-500/40" : "border-border/30",
      )}
      data-testid="society-feed"
    >
      {effective.feed.map((item, i) => {
        if (item.kind === "round_start") {
          return (
            <div key={i} className="flex items-center gap-2 my-1.5" data-testid={`feed-round-${item.round}`}>
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono px-2">
                round {item.round}
              </span>
              <div className="flex-1 h-px bg-border/40" />
            </div>
          );
        }
        if (item.kind === "world_event") {
          return (
            <div
              key={i}
              className="self-center max-w-[90%] flex items-start gap-2 text-[11px] italic text-muted-foreground bg-muted/30 border border-border/30 rounded-xl px-3 py-1.5"
              data-testid={`feed-world-${item.round}`}
            >
              <Globe2 className="h-3 w-3 mt-0.5 shrink-0 text-sky-400" />
              <span>{item.text}</span>
            </div>
          );
        }
        if (item.kind === "narrator") {
          return (
            <div
              key={i}
              className="self-center max-w-[95%] flex items-start gap-2 text-[12px] text-foreground/90 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/30 rounded-xl px-3 py-2 my-1"
              data-testid={`feed-narrator-${item.round}`}
            >
              <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-400" />
              <div>
                <div className="text-[9px] uppercase tracking-widest text-violet-400 font-mono mb-0.5">
                  narrator · {item.phase}
                </div>
                {item.text}
              </div>
            </div>
          );
        }
        // statement
        const agent = agentsById[item.agentId];
        if (!agent) return null;
        const target = item.target ? agentsById[item.target] : null;
        return (
          <div key={i} className="flex items-start gap-2" data-testid={`feed-statement-${item.round}-${agent.id}`}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-slate-950 shrink-0 mt-0.5"
              style={{ backgroundColor: agent.color }}
            >
              {agent.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 text-[10px] mb-0.5">
                <span className="font-semibold" style={{ color: agent.color }}>
                  {agent.name}
                </span>
                {agent.agitator && (
                  <AlertTriangle className="h-2.5 w-2.5 text-rose-400" aria-label="agitator" />
                )}
                {target && (
                  <span className="text-muted-foreground">
                    → <span style={{ color: target.color }}>{target.name}</span>
                  </span>
                )}
                <span className="text-muted-foreground/60 font-mono ml-auto">
                  stance {item.valence >= 0 ? "+" : ""}
                  {item.valence.toFixed(2)}
                </span>
              </div>
              <div
                className={cn(
                  "text-[13px] leading-snug rounded-2xl px-3 py-1.5 border",
                  agent.agitator
                    ? "bg-rose-500/10 border-rose-500/30"
                    : "bg-muted/40 border-border/40"
                )}
              >
                {item.text}
              </div>
            </div>
          </div>
        );
      })}
      {isRunning && (
        <div className="self-center text-[10px] text-muted-foreground italic font-mono mt-1">
          {state.currentRound > 0 ? `round ${state.currentRound} in progress…` : "warming up…"}
        </div>
      )}
    </div>
  );
}

function SidePanel({ state, effective }: { state: SocietyState; effective: EffectiveView }) {
  return (
    <div className="hidden lg:flex flex-col gap-2 min-h-0">
      <InfluenceGraph state={state} effective={effective} />
      <ConstellationMap state={state} effective={effective} />
      <ReputationMatrix state={state} effective={effective} />
    </div>
  );
}

function ConstellationMap({ state, effective }: { state: SocietyState; effective: EffectiveView }) {
  const size = 220;
  const pad = 18;
  const inner = size - pad * 2;

  const agentsById = useMemo(
    () => Object.fromEntries(state.agents.map((a) => [a.id, a])),
    [state.agents],
  );

  // Map raw PCA coords into the SVG's [pad, size-pad] box, preserving aspect.
  const layout = useMemo(() => {
    const pos = effective.clusterPositions;
    if (pos.length === 0) return [];
    const xs = pos.map((p) => p.x);
    const ys = pos.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const span = Math.max(spanX, spanY);
    return pos.map((p) => {
      const nx = (p.x - (minX + maxX) / 2) / span; // -0.5 .. 0.5
      const ny = (p.y - (minY + maxY) / 2) / span;
      return {
        agentId: p.agentId,
        cx: pad + inner / 2 + nx * inner * 0.85,
        cy: pad + inner / 2 + ny * inner * 0.85,
      };
    });
  }, [effective.clusterPositions, inner]);

  return (
    <div
      className="rounded-xl bg-card/30 border border-border/30 p-2 flex flex-col"
      data-testid="constellation-map"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
        <Telescope className="h-3 w-3" /> belief constellation
        {effective.clusterRound > 0 && (
          <span className="ml-auto normal-case tracking-normal text-muted-foreground/70">
            r{effective.clusterRound}
          </span>
        )}
      </div>
      <div className="flex items-center justify-center">
        {layout.length === 0 ? (
          <div className="text-[10px] text-muted-foreground/70 italic font-mono py-6">
            waiting for first round…
          </div>
        ) : (
          <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px]">
            {/* faint axes */}
            <line
              x1={pad}
              y1={size / 2}
              x2={size - pad}
              y2={size / 2}
              stroke="currentColor"
              className="text-border/40"
              strokeDasharray="2 4"
            />
            <line
              x1={size / 2}
              y1={pad}
              x2={size / 2}
              y2={size - pad}
              stroke="currentColor"
              className="text-border/40"
              strokeDasharray="2 4"
            />
            {layout.map((p) => {
              const a = agentsById[p.agentId];
              if (!a) return null;
              return (
                <g
                  key={p.agentId}
                  transform={`translate(${p.cx}, ${p.cy})`}
                  style={{ transition: "transform 600ms ease" }}
                  data-testid={`constellation-dot-${p.agentId}`}
                >
                  {a.agitator && (
                    <circle
                      cx={0}
                      cy={0}
                      r={11}
                      fill="none"
                      stroke="#f43f5e"
                      strokeOpacity={0.5}
                      strokeWidth={1.5}
                    />
                  )}
                  <circle
                    cx={0}
                    cy={0}
                    r={6}
                    fill={a.color}
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={-9}
                    fontSize="8"
                    textAnchor="middle"
                    fill="#cbd5e1"
                    fontFamily="ui-monospace, monospace"
                  >
                    {a.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="text-center text-[9px] text-muted-foreground/70 font-mono pt-0.5">
        2D PCA of belief vectors · close = aligned
      </div>
    </div>
  );
}

function InfluenceGraph({ state, effective }: { state: SocietyState; effective: EffectiveView }) {
  // Aggregate edge weights across all rounds: edge[from][to] = sum of pull magnitudes
  const edges = useMemo(() => {
    const map = new Map<string, { from: string; to: string; weight: number; up: number; down: number }>();
    for (const inf of effective.influences) {
      const k = `${inf.from}->${inf.to}`;
      const e = map.get(k) ?? { from: inf.from, to: inf.to, weight: 0, up: 0, down: 0 };
      e.weight += inf.weight;
      if (inf.direction === "up") e.up += inf.weight;
      else e.down += inf.weight;
      map.set(k, e);
    }
    return Array.from(map.values());
  }, [effective.influences]);

  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 36;
  const n = state.agents.length;

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    state.agents.forEach((a, i) => {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pos[a.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
    return pos;
  }, [state.agents, n, cx, cy, r]);

  const maxWeight = Math.max(0.001, ...edges.map((e) => e.weight));

  return (
    <div
      className="rounded-xl bg-card/30 border border-border/30 p-2 flex-1 min-h-0 flex flex-col"
      data-testid="influence-graph"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
        <Network className="h-3 w-3" /> influence graph
      </div>
      <div className="flex-1 flex items-center justify-center min-h-0">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full max-h-[280px]">
          <defs>
            <marker id="arrow-up" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#34d399" />
            </marker>
            <marker id="arrow-down" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#f87171" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const from = positions[e.from];
            const to = positions[e.to];
            if (!from || !to) return null;
            const dominant = e.up >= e.down ? "up" : "down";
            const stroke = dominant === "up" ? "#34d399" : "#f87171";
            const sw = 0.5 + (e.weight / maxWeight) * 4;
            // Curve the line slightly
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const norm = Math.sqrt(dx * dx + dy * dy) || 1;
            const ox = (-dy / norm) * 14;
            const oy = (dx / norm) * 14;
            // Pull endpoint back so arrowhead doesn't sit under the circle
            const tx = to.x - (dx / norm) * 16;
            const ty = to.y - (dy / norm) * 16;
            return (
              <path
                key={i}
                d={`M ${from.x} ${from.y} Q ${mx + ox} ${my + oy} ${tx} ${ty}`}
                stroke={stroke}
                strokeOpacity={0.55}
                strokeWidth={sw}
                fill="none"
                markerEnd={`url(#arrow-${dominant})`}
              />
            );
          })}
          {state.agents.map((a) => {
            const p = positions[a.id];
            if (!p) return null;
            const initial = a.name[0]?.toUpperCase() ?? "?";
            return (
              <g key={a.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={16}
                  fill={a.color}
                  stroke={a.agitator ? "#f43f5e" : "rgba(0,0,0,0.4)"}
                  strokeWidth={a.agitator ? 2 : 1}
                />
                <text
                  x={p.x}
                  y={p.y + 4}
                  fontSize="11"
                  fontWeight="bold"
                  fill="#0f172a"
                  textAnchor="middle"
                >
                  {initial}
                </text>
                <text
                  x={p.x}
                  y={p.y + 30}
                  fontSize="9"
                  fill="#cbd5e1"
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                >
                  {a.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-center gap-3 text-[9px] text-muted-foreground font-mono pt-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> pulled toward
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-red-400 inline-block" /> pushed away
        </span>
      </div>
    </div>
  );
}

function ReputationMatrix({ state, effective }: { state: SocietyState; effective: EffectiveView }) {
  return (
    <div className="rounded-xl bg-card/30 border border-border/30 p-2" data-testid="reputation-matrix">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1.5">
        reputation (row trusts col)
      </div>
      <div className="grid gap-px text-[10px]" style={{ gridTemplateColumns: `auto repeat(${state.agents.length}, 1fr)` }}>
        <div />
        {state.agents.map((a) => (
          <div
            key={"h-" + a.id}
            className="text-center font-bold py-0.5"
            style={{ color: a.color }}
            title={a.name}
          >
            {a.name[0]}
          </div>
        ))}
        {state.agents.map((row) => (
          <React.Fragment key={"r-" + row.id}>
            <div className="font-bold pr-1 text-right py-0.5" style={{ color: row.color }} title={row.name}>
              {row.name[0]}
            </div>
            {state.agents.map((col) => {
              if (row.id === col.id) {
                return <div key={col.id} className="text-center text-muted-foreground/30 py-0.5">·</div>;
              }
              const trust = effective.reputation[row.id]?.[col.id] ?? 0.5;
              const intensity = Math.abs(trust - 0.5) * 2; // 0..1
              const positive = trust >= 0.5;
              return (
                <div
                  key={col.id}
                  className="text-center font-mono py-0.5 rounded"
                  style={{
                    backgroundColor: positive
                      ? `rgba(52, 211, 153, ${0.08 + intensity * 0.45})`
                      : `rgba(248, 113, 113, ${0.08 + intensity * 0.45})`,
                    color: intensity > 0.5 ? (positive ? "#bbf7d0" : "#fecaca") : "#94a3b8",
                  }}
                  title={`${row.name} → ${col.name}: ${trust.toFixed(2)}`}
                  data-testid={`rep-${row.id}-${col.id}`}
                >
                  {trust.toFixed(2)}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
