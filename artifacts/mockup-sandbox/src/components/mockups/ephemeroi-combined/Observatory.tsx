import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Activity, 
  Terminal, 
  Zap, 
  Database, 
  GitBranch, 
  Rss, 
  Globe, 
  AlertTriangle, 
  BrainCircuit,
  MessageSquare,
  Search,
  CheckCircle2,
  Cpu,
  Activity as Waveform,
  Play
} from "lucide-react";

export function Observatory() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Mock data
  const spectralMetrics = [
    { name: "Illumination Density", value: 78, trend: "+2.4", color: "bg-cyan-400" },
    { name: "Mobility", value: 45, trend: "-1.2", color: "bg-cyan-500" },
    { name: "Stagnation", value: 12, trend: "-5.0", color: "bg-cyan-700" }
  ];

  const beliefs = [
    { id: "B-094", text: "LLMs are converging on similar safety failure modes", conf: 0.92 },
    { id: "B-095", text: "Open source models trailing by exactly 6 months", conf: 0.85 },
    { id: "B-096", text: "Compute constraints driving algorithmic efficiency", conf: 0.78 }
  ];

  const tensions = [
    { id: "T-012", desc: "Scaling laws vs Data wall predictions", severity: "high" },
    { id: "T-013", desc: "Open weights safety vs closed model security", severity: "medium" }
  ];

  const observations = [
    { time: "14:23:01", source: "arxiv-cs.AI", text: "New paper on sub-quadratic attention mechanisms" },
    { time: "14:22:45", source: "github/openai", text: "Commit merged in whisper: minor bugfix" },
    { time: "14:20:12", source: "Hacker News", text: "Discussion: The end of Moore's Law?" }
  ];

  const sources = [
    { name: "arxiv-cs.AI", type: "RSS", status: "Active", icon: Rss },
    { name: "openai/whisper", type: "GitHub", status: "Polling", icon: GitBranch },
    { name: "Anthropic Blog", type: "Web", status: "Active", icon: Globe }
  ];

  const societyAgents = [
    { name: "Ockham", stance: "Reductionist", vector: [0.8, -0.2, 0.1], belief: "Simplify attention layers" },
    { name: "Lovelace", stance: "Expansionist", vector: [-0.4, 0.9, 0.5], belief: "Parameter count matters most" },
    { name: "Turing", stance: "Synthesizer", vector: [0.1, 0.1, 0.9], belief: "Architecture and scale must co-evolve" }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-cyan-50 font-['Inter',sans-serif] p-4 flex flex-col gap-4 overflow-hidden selection:bg-cyan-900 selection:text-cyan-50">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .grid-dashboard {
          display: grid;
          grid-template-columns: 300px 1fr 350px;
          grid-template-rows: auto 1fr auto;
          gap: 1rem;
          height: calc(100vh - 2rem);
        }
        .scanline {
          width: 100%;
          height: 100px;
          z-index: 10;
          position: absolute;
          pointer-events: none;
          background: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(34,211,238,0.1) 50%, rgba(0,0,0,0) 100%);
          animation: scan 8s linear infinite;
        }
        @keyframes scan {
          0% { transform: translateY(-100px); }
          100% { transform: translateY(100vh); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: rgba(2, 6, 23, 0.5); }
        ::-webkit-scrollbar-thumb { background: rgba(34, 211, 238, 0.2); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(34, 211, 238, 0.4); }
      `}} />
      
      <div className="scanline absolute inset-0 mix-blend-overlay"></div>

      {/* Top Bar */}
      <header className="col-span-3 border-b border-cyan-900/50 pb-4 flex justify-between items-center z-20 relative">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-cyan-950 border border-cyan-500/30 flex items-center justify-center rounded-sm">
            <Activity className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-cyan-50">OBSERVATORY</h1>
            <div className="text-xs font-mono text-cyan-500/70 flex gap-4">
              <span>SYS.STATUS: NOMINAL</span>
              <span>PHASE: COHERENT</span>
              <span>CYCLE: 4492.1</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-cyan-500/50 uppercase tracking-widest font-mono">Transit Medium</span>
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
              <span>Conductance: 0.94</span>
              <span className="text-cyan-700">|</span>
              <span>Backpressure: 12%</span>
            </div>
          </div>
          <Button size="sm" variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-950/30 hover:bg-cyan-900/50 hover:text-cyan-300 font-mono text-xs rounded-sm">
            <Zap className="h-3 w-3 mr-2" />
            INIT SELF-BUILD LOOP
          </Button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 z-20 relative">
        
        {/* Left Column: State & Sources */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          {/* Spectral Metrics */}
          <Card className="bg-slate-950/50 border-cyan-900/50 rounded-sm overflow-hidden flex-shrink-0">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-mono uppercase text-cyan-500 tracking-widest flex items-center gap-2">
                <Waveform className="h-3 w-3" />
                Spectral Phase
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-col gap-3">
              {spectralMetrics.map((metric) => (
                <div key={metric.name} className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-cyan-200/70">{metric.name}</span>
                    <span className="text-cyan-400">{metric.value}% <span className="text-cyan-600 ml-1">{metric.trend}</span></span>
                  </div>
                  <Progress value={metric.value} className="h-1 bg-cyan-950" indicatorClassName={metric.color} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Sources */}
          <Card className="bg-slate-950/50 border-cyan-900/50 rounded-sm overflow-hidden flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
              <CardTitle className="text-xs font-mono uppercase text-cyan-500 tracking-widest flex items-center gap-2">
                <Database className="h-3 w-3" />
                Active Sources
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex-1 overflow-hidden">
              <ScrollArea className="h-full pr-4">
                <div className="space-y-3">
                  {sources.map((source, i) => (
                    <div key={i} className="flex items-center justify-between group">
                      <div className="flex items-center gap-2">
                        <source.icon className="h-3 w-3 text-cyan-600 group-hover:text-cyan-400 transition-colors" />
                        <span className="text-sm text-cyan-100/90">{source.name}</span>
                      </div>
                      <Badge variant="outline" className="border-cyan-800 text-cyan-500 text-[10px] uppercase font-mono px-1 py-0 h-4 rounded-sm">
                        {source.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Center Column: Query Console & Council */}
        <div className="col-span-6 flex flex-col gap-4 min-h-0">
          
          {/* Metacognitive Search Console */}
          <Card className="bg-slate-950/50 border-cyan-900/50 rounded-sm overflow-hidden flex-shrink-0">
            <CardHeader className="pb-2 pt-4 px-4 border-b border-cyan-900/30">
              <CardTitle className="text-xs font-mono uppercase text-cyan-500 tracking-widest flex items-center gap-2">
                <Terminal className="h-3 w-3" />
                Metacognitive Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-4 border-b border-cyan-900/30 bg-cyan-950/10">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-600" />
                    <Input 
                      placeholder="Query the cognitive field..." 
                      className="pl-9 bg-slate-950 border-cyan-800/50 text-cyan-100 placeholder:text-cyan-800 rounded-sm focus-visible:ring-cyan-500/50 focus-visible:border-cyan-500/50 font-mono text-sm"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <Button onClick={() => setIsSearching(true)} className="rounded-sm bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono text-sm">
                    Execute
                  </Button>
                </div>
              </div>
              <div className="p-4 font-mono text-xs text-cyan-400/80 space-y-2 h-[120px] overflow-hidden bg-slate-950/80">
                {isSearching ? (
                  <>
                    <div className="flex items-center gap-2 text-cyan-300">
                      <Play className="h-3 w-3 animate-pulse" />
                      <span>Decomposing query constraints...</span>
                    </div>
                    <div className="flex items-center gap-2 text-cyan-500/70 pl-5">
                      <span>├─ Extracted entity: attention mechanisms</span>
                    </div>
                    <div className="flex items-center gap-2 text-cyan-500/70 pl-5">
                      <span>├─ Temporal bound: last 6 months</span>
                    </div>
                    <div className="flex items-center gap-2 text-cyan-300">
                      <Globe className="h-3 w-3 animate-pulse" />
                      <span>Retrieving from Dataverse...</span>
                    </div>
                  </>
                ) : (
                  <div className="text-cyan-800 flex h-full items-center justify-center italic">
                    Awaiting input vector...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Society Debate */}
          <Card className="bg-slate-950/50 border-cyan-900/50 rounded-sm overflow-hidden flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 pt-4 px-4 border-b border-cyan-900/30 flex-shrink-0">
              <CardTitle className="text-xs font-mono uppercase text-cyan-500 tracking-widest flex items-center gap-2">
                <BrainCircuit className="h-3 w-3" />
                Council Chamber (Society Mode)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex-1 overflow-hidden">
              <ScrollArea className="h-full pr-4">
                <div className="space-y-4">
                  {societyAgents.map((agent, i) => (
                    <div key={i} className="flex gap-4 items-start p-3 bg-cyan-950/10 border border-cyan-900/30 rounded-sm">
                      <div className="flex-shrink-0 flex flex-col items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-slate-900 border border-cyan-700 flex items-center justify-center text-cyan-400 font-mono text-sm">
                          {agent.name.charAt(0)}
                        </div>
                        <span className="text-[9px] font-mono text-cyan-600 uppercase">{agent.stance}</span>
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold text-cyan-100">{agent.name}</span>
                          <span className="text-[10px] font-mono text-cyan-500/60">
                            V: [{agent.vector.join(", ")}]
                          </span>
                        </div>
                        <p className="text-sm text-cyan-200/80 italic border-l-2 border-cyan-800 pl-3">
                          "{agent.belief}"
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>

        {/* Right Column: Feed, Beliefs, Tensions */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          
          <Card className="bg-slate-950/50 border-cyan-900/50 rounded-sm overflow-hidden flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 pt-4 px-4 border-b border-cyan-900/30 flex-shrink-0">
              <Tabs defaultValue="observations" className="w-full">
                <TabsList className="grid grid-cols-3 bg-cyan-950/30 h-8 p-1 rounded-sm">
                  <TabsTrigger value="observations" className="text-[10px] font-mono uppercase data-[state=active]:bg-cyan-900 data-[state=active]:text-cyan-100 rounded-sm">Feed</TabsTrigger>
                  <TabsTrigger value="beliefs" className="text-[10px] font-mono uppercase data-[state=active]:bg-cyan-900 data-[state=active]:text-cyan-100 rounded-sm">Beliefs</TabsTrigger>
                  <TabsTrigger value="tensions" className="text-[10px] font-mono uppercase data-[state=active]:bg-cyan-900 data-[state=active]:text-cyan-100 rounded-sm">Tensions</TabsTrigger>
                </TabsList>
                
                <TabsContent value="observations" className="mt-4 flex-1 h-[calc(100vh-280px)]">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-4">
                      {observations.map((obs, i) => (
                        <div key={i} className="space-y-1 relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-[-16px] last:before:hidden before:w-px before:bg-cyan-900/50">
                          <div className="absolute left-[-4px] top-1.5 h-2 w-2 rounded-full bg-cyan-800 border border-cyan-500"></div>
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] font-mono text-cyan-500/70">{obs.time}</span>
                            <span className="text-[10px] font-mono text-cyan-600">[{obs.source}]</span>
                          </div>
                          <p className="text-xs text-cyan-100/90 leading-relaxed">{obs.text}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="beliefs" className="mt-4 flex-1 h-[calc(100vh-280px)]">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-3">
                      {beliefs.map((belief, i) => (
                        <div key={i} className="p-3 bg-cyan-950/20 border border-cyan-900/40 rounded-sm space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-mono text-cyan-500">{belief.id}</span>
                            <Badge variant="outline" className="border-cyan-800 text-cyan-400 text-[9px] font-mono px-1 py-0 h-4 rounded-sm">
                              C:{belief.conf.toFixed(2)}
                            </Badge>
                          </div>
                          <p className="text-xs text-cyan-50">{belief.text}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="tensions" className="mt-4 flex-1 h-[calc(100vh-280px)]">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-3">
                      {tensions.map((tension, i) => (
                        <div key={i} className="p-3 bg-rose-950/20 border border-rose-900/40 rounded-sm space-y-2 relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-rose-600/50"></div>
                          <div className="flex justify-between items-center pl-2">
                            <span className="text-[10px] font-mono text-rose-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {tension.id}
                            </span>
                            <span className="text-[9px] font-mono text-rose-500/70 uppercase">{tension.severity}</span>
                          </div>
                          <p className="text-xs text-rose-100/90 pl-2">{tension.desc}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

              </Tabs>
            </CardHeader>
          </Card>

        </div>
      </div>
    </div>
  );
}

export default Observatory;