import React, { useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SocietyState, SocietyAgent } from "@/hooks/use-society-stream";
import { AlertTriangle, Sparkles, Globe2, Users, Network } from "lucide-react";

interface SocietyViewProps {
  state: SocietyState;
  isRunning: boolean;
}

export function SocietyView({ state, isRunning }: SocietyViewProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [state.feed.length]);

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
      <AgentsRow state={state} />

      {/* Middle: split — debate feed | influence graph */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-2 px-2 pb-2 min-h-0">
        <DebateFeed state={state} feedRef={feedRef} isRunning={isRunning} />
        <SidePanel state={state} />
      </div>
    </div>
  );
}

function AgentsRow({ state }: { state: SocietyState }) {
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
          <AgentChip key={a.id} agent={a} belief={state.beliefs[a.id] ?? a.belief} />
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
  feedRef,
  isRunning,
}: {
  state: SocietyState;
  feedRef: React.RefObject<HTMLDivElement | null>;
  isRunning: boolean;
}) {
  const agentsById = useMemo(() => Object.fromEntries(state.agents.map((a) => [a.id, a])), [state.agents]);

  return (
    <div
      ref={feedRef}
      className="overflow-y-auto rounded-xl bg-card/30 border border-border/30 p-3 flex flex-col gap-2 min-h-0"
      data-testid="society-feed"
    >
      {state.feed.map((item, i) => {
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

function SidePanel({ state }: { state: SocietyState }) {
  return (
    <div className="hidden lg:flex flex-col gap-2 min-h-0">
      <InfluenceGraph state={state} />
      <ReputationMatrix state={state} />
    </div>
  );
}

function InfluenceGraph({ state }: { state: SocietyState }) {
  // Aggregate edge weights across all rounds: edge[from][to] = sum of pull magnitudes
  const edges = useMemo(() => {
    const map = new Map<string, { from: string; to: string; weight: number; up: number; down: number }>();
    for (const inf of state.influences) {
      const k = `${inf.from}->${inf.to}`;
      const e = map.get(k) ?? { from: inf.from, to: inf.to, weight: 0, up: 0, down: 0 };
      e.weight += inf.weight;
      if (inf.direction === "up") e.up += inf.weight;
      else e.down += inf.weight;
      map.set(k, e);
    }
    return Array.from(map.values());
  }, [state.influences]);

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

function ReputationMatrix({ state }: { state: SocietyState }) {
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
              const trust = state.reputation[row.id]?.[col.id] ?? 0.5;
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
