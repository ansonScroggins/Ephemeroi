import React from "react";
import { ChatComposer } from "@/components/query-interface";
import { ChatFeed } from "@/components/reasoning-stream";
import { useSearchStream } from "@/hooks/use-search-stream";

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

      {/* Composer */}
      <div className="shrink-0 border-t border-border/40 bg-card/70 backdrop-blur-xl">
        <div className="w-full max-w-2xl mx-auto">
          <ChatComposer onSubmit={(opts) => startSearch(opts)} isRunning={isRunning} />
        </div>
      </div>
    </div>
  );
}
