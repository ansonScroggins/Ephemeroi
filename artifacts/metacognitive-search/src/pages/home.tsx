import React from "react";
import { QueryInterface } from "@/components/query-interface";
import { ReasoningStream } from "@/components/reasoning-stream";
import { ArchitectureLegend } from "@/components/architecture-legend";
import { useSearchStream } from "@/hooks/use-search-stream";

export default function Home() {
  const {
    startSearch,
    isRunning,
    events,
    liveTokenStream,
    activeStepType
  } = useSearchStream();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col overflow-hidden font-sans">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur shrink-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <span className="font-mono font-bold text-primary-foreground text-sm">MC</span>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase font-mono">Metacognitive Search</h1>
            <p className="text-xs text-muted-foreground font-mono">Research Instrument v1.0.4</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            {isRunning ? 'Processing' : 'Standby'}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="h-full w-full max-w-[1600px] mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Query Interface & Info */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            <section className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4 border-b border-border pb-2">Query Input</h2>
              <QueryInterface onSubmit={(opts) => startSearch(opts)} isRunning={isRunning} />
            </section>
            
            <section className="bg-card border border-border rounded-lg p-4 shadow-sm flex-1 hidden lg:block">
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 border-b border-border pb-2">System Status</h2>
              <div className="space-y-4 mt-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-mono">Model</span>
                    <span className="font-mono" title="Set OPENAI_MODEL env var to override">gpt-5.2 (default)</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-mono">Transport</span>
                    <span className="font-mono">SSE / streaming</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-mono">Max retrieval steps</span>
                    <span className="font-mono text-emerald-500">5</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-mono">Modes</span>
                    <span className="font-mono text-cyan-400">research · code · web</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground font-mono">Web search</span>
                    <span className="font-mono text-cyan-400">live (Responses API)</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Middle Column: Live Reasoning Stream */}
          <div className="lg:col-span-6 bg-card/30 border border-border rounded-lg shadow-sm flex flex-col overflow-hidden relative">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
            <div className="p-4 border-b border-border/50 bg-card/80 backdrop-blur z-10 flex justify-between items-center shrink-0">
              <h2 className="text-xs font-mono uppercase tracking-widest text-foreground flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                Live Reasoning Stream
              </h2>
            </div>
            <div className="flex-1 overflow-hidden p-4 md:p-6 z-0">
              <ReasoningStream 
                events={events} 
                liveTokenStream={liveTokenStream} 
                isRunning={isRunning} 
              />
            </div>
          </div>

          {/* Right Column: Architecture Legend */}
          <div className="lg:col-span-3 hidden lg:block">
            <ArchitectureLegend activeStepType={activeStepType} />
          </div>

        </div>
      </main>
    </div>
  );
}