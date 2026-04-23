import React, { useEffect, useRef, useState, useCallback } from "react";
import { ChatComposer } from "@/components/query-interface";
import { ChatFeed } from "@/components/reasoning-stream";
import { MemoryPill } from "@/components/memory-pill";
import { useSearchStream, type SearchMode } from "@/hooks/use-search-stream";
import { findSimilar, saveRun, type MemoryMatch } from "@/lib/memory";

const ACTIVE_LABEL: Record<string, string> = {
  WEB_SEARCH: "searching the web…",
  DECOMPOSE: "thinking it through…",
  PATTERN: "spotting patterns…",
  RETRIEVE: "digging for findings…",
  EVALUATE: "checking my coverage…",
  PIVOT: "changing tack…",
  SYNTHESIZE: "writing it up…",
  REFLECT: "reflecting…",
};

export default function Home() {
  const {
    startSearch,
    isRunning,
    query,
    events,
    liveTokenStream,
    activeStepType,
  } = useSearchStream();

  // Memory layer state
  const [memoryMatch, setMemoryMatch] = useState<MemoryMatch | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [prefill, setPrefill] = useState<{ query: string; nonce: number } | null>(null);
  const [currentMode, setCurrentMode] = useState<SearchMode>("research");
  const savedForRunRef = useRef<string | null>(null);

  // Lookup similar past runs as the user types
  const handleQueryChange = useCallback(
    (q: string, mode: SearchMode) => {
      if (q.trim().length < 4) {
        setMemoryMatch(null);
        return;
      }
      const match = findSimilar(q, mode);
      if (match && !dismissedIds.has(match.entry.id)) {
        setMemoryMatch(match);
      } else {
        setMemoryMatch(null);
      }
    },
    [dismissedIds]
  );

  // Persist a run when it completes (REFLECT has arrived + run finished)
  useEffect(() => {
    if (isRunning) return;
    if (!query) return;
    const completed = events.some((e) => e.type === "complete");
    if (!completed) return;
    const runKey = `${currentMode}::${query}`;
    if (savedForRunRef.current === runKey) return;
    saveRun({ query, mode: currentMode, events });
    savedForRunRef.current = runKey;
  }, [isRunning, events, query, currentMode]);

  // Hide the memory pill while a run is in progress
  useEffect(() => {
    if (isRunning) setMemoryMatch(null);
  }, [isRunning]);

  const status = isRunning
    ? activeStepType
      ? ACTIVE_LABEL[activeStepType] ?? "thinking…"
      : "thinking…"
    : "online";

  return (
    <div className="h-[100dvh] bg-gradient-to-b from-slate-950 via-background to-background text-foreground flex flex-col font-sans overflow-hidden">
      {/* iMessage-style top bar */}
      <header className="border-b border-border/40 bg-card/70 backdrop-blur-xl shrink-0 px-4 py-3 flex items-center justify-center relative">
        <div className="flex flex-col items-center gap-1">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="font-bold text-white text-sm">AI</span>
            </div>
            {isRunning && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-card animate-pulse" />
            )}
            {!isRunning && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-card" />
            )}
          </div>
          <div className="text-center leading-tight">
            <div className="text-sm font-semibold">Metacog</div>
            <div className="text-[10px] text-muted-foreground italic" data-testid="text-status">
              {status}
            </div>
          </div>
        </div>
      </header>

      {/* Chat feed */}
      <main className="flex-1 overflow-hidden flex flex-col items-center">
        <div className="w-full max-w-2xl flex-1 overflow-hidden flex flex-col">
          <ChatFeed
            query={query}
            events={events}
            liveTokenStream={liveTokenStream}
            isRunning={isRunning}
            activeStepType={activeStepType}
          />
        </div>
      </main>

      {/* Composer (with optional memory pill above it) */}
      <div className="shrink-0 border-t border-border/40 bg-card/70 backdrop-blur-xl">
        <div className="w-full max-w-2xl mx-auto">
          <MemoryPill
            match={memoryMatch}
            onDismiss={() => {
              if (memoryMatch) {
                setDismissedIds((prev) => new Set(prev).add(memoryMatch.entry.id));
              }
              setMemoryMatch(null);
            }}
            onReuse={(q) => {
              setPrefill({ query: q, nonce: Date.now() });
              setMemoryMatch(null);
            }}
          />
          <ChatComposer
            onSubmit={(opts) => startSearch(opts)}
            isRunning={isRunning}
            onQueryChange={handleQueryChange}
            onModeChange={setCurrentMode}
            prefill={prefill}
          />
        </div>
      </div>
    </div>
  );
}
