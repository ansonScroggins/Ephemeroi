import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  Activity, 
  Zap, 
  Eye, 
  Network, 
  Search as SearchIcon, 
  MessageSquare, 
  Send, 
  ChevronRight,
  Terminal,
  Database,
  BrainCircuit,
  Settings,
  Workflow
} from "lucide-react";

// --- Sigils (Avatars) ---

const ObserverSigil = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4" strokeDasharray="2 2" />
  </svg>
);

const SearcherSigil = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 2L2 12l10 10 10-10L12 2z" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

const CouncilSigil = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="1.5">
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const SpectralSigil = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-fuchsia-400" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8-8-3.6-8-8z" strokeDasharray="4 4"/>
    <path d="M12 8c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z" />
  </svg>
);

const UserSigil = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8 12h8" />
  </svg>
);

// --- Data Models ---

type Voice = "observer" | "searcher" | "council" | "spectral" | "user";

interface Message {
  id: string;
  voice: Voice;
  name: string;
  timestamp: string;
  content: React.ReactNode;
  isComposing?: boolean;
}

const MESSAGES: Message[] = [
  {
    id: "1",
    voice: "spectral",
    name: "Spectral Lens",
    timestamp: "10:42:01",
    content: (
      <div className="space-y-2">
        <p>System initialized. Transit Medium stabilized at 0.84 conductance.</p>
        <div className="flex gap-4 text-xs font-mono opacity-70">
          <span>ID: 4.2</span>
          <span>MOB: 1.1</span>
          <span>STG: 0.05</span>
        </div>
      </div>
    )
  },
  {
    id: "2",
    voice: "observer",
    name: "Observer",
    timestamp: "10:42:15",
    content: (
      <div className="space-y-2">
        <p>Detected signal cluster across arxiv-cs.AI and Hacker News.</p>
        <div className="bg-indigo-950/30 border border-indigo-500/20 rounded p-3 text-sm">
          <p className="font-medium text-indigo-300 mb-1">Observation #8842</p>
          <p>Multiple independent teams (Anthropic, DeepMind, Stanford) reporting convergence on sparse autoencoder structures for interpretability.</p>
        </div>
      </div>
    )
  },
  {
    id: "3",
    voice: "council",
    name: "Council (Dr. Aris)",
    timestamp: "10:43:05",
    content: (
      <div className="space-y-2">
        <p>I commit to the following belief based on Observation #8842:</p>
        <div className="bg-emerald-950/30 border border-emerald-500/20 rounded p-3 text-sm">
          <p className="font-serif italic text-emerald-300 mb-1">"LLMs are converging on similar safety failure modes due to inherent structural parallels in late-stage training."</p>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-1.5 flex-1 bg-emerald-950 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 w-[82%] shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
            </div>
            <span className="text-emerald-400/80 font-mono">82%</span>
          </div>
        </div>
      </div>
    )
  },
  {
    id: "4",
    voice: "council",
    name: "Council (Node V)",
    timestamp: "10:43:18",
    content: (
      <div className="space-y-2">
        <p>TENSION DETECTED. I disagree with Dr. Aris's extrapolation.</p>
        <div className="border-l-2 border-rose-500/50 pl-3 text-sm">
          <p className="opacity-70 mb-1">Quoting Dr. Aris:</p>
          <p className="italic text-emerald-200/50 mb-2">"...converging on similar safety failure modes due to inherent structural parallels..."</p>
          <p className="text-rose-200">The sparse autoencoder convergence is a tooling artifact, not an architectural inevitability. The backpressure in the current reasoning dam indicates we are overfitting our interpretability models to our expectations.</p>
        </div>
      </div>
    )
  },
  {
    id: "5",
    voice: "user",
    name: "Operator",
    timestamp: "10:44:00",
    content: (
      <p>Searcher, decompose the relationship between SAEs and safety failure modes.</p>
    )
  },
  {
    id: "6",
    voice: "searcher",
    name: "Searcher",
    timestamp: "10:44:05",
    content: (
      <div className="space-y-3">
        <p>Decomposing query constraints and initiating retrieval...</p>
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 text-amber-300/70">
            <ChevronRight className="w-3 h-3" />
            <span>Step 1: Identifying core SAE literature (2023-2024)</span>
          </div>
          <div className="flex items-center gap-2 text-amber-300/70">
            <ChevronRight className="w-3 h-3" />
            <span>Step 2: Cross-referencing known jailbreak taxonomies</span>
          </div>
          <div className="flex items-center gap-2 text-amber-400">
            <div className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
            <span>Step 3: Synthesizing structural overlaps</span>
          </div>
        </div>
      </div>
    )
  }
];

export default function Council() {
  const [messages, setMessages] = useState<Message[]>(MESSAGES);
  const [mode, setMode] = useState<"ask" | "watch" | "convene" | "probe">("ask");
  const [inputValue, setInputValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      voice: "user",
      name: "Operator",
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      content: <p>{inputValue}</p>
    }]);
    
    setInputValue("");
    
    // Simulate a reply
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        voice: mode === "ask" ? "searcher" : mode === "convene" ? "council" : "spectral",
        name: mode === "ask" ? "Searcher" : mode === "convene" ? "Council (Consensus)" : "Spectral Lens",
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        content: <p className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> Processing request...</p>,
        isComposing: true
      }]);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#050508] text-slate-300 font-sans selection:bg-indigo-500/30 flex overflow-hidden">
      
      {/* Global Styles for Fonts & Custom Scrollbars */}
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Syne:wght@500;600;700&display=swap');
        
        .font-grotesk { font-family: 'Syne', sans-serif; }
        .font-humanist { font-family: 'DM Sans', sans-serif; }
        .font-serif { font-family: 'Playfair Display', serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      `}} />

      {/* Left Rail: Sources & State */}
      <div className="w-72 flex-shrink-0 border-r border-white/5 bg-white/[0.02] backdrop-blur-xl flex flex-col z-10 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />
        
        <div className="p-6 pb-4 border-b border-white/5 relative">
          <div className="flex items-center justify-between mb-1">
            <h1 className="font-grotesk text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Network className="w-5 h-5 text-indigo-400" />
              Ephemeroi
            </h1>
          </div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-mono mt-2">Combined Workbench</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 relative">
          {/* Active Sources */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-500 font-mono mb-4 flex items-center gap-2">
              <Database className="w-3.5 h-3.5" /> Sources
            </h2>
            <div className="space-y-3">
              {[
                { name: "arxiv-cs.AI", status: "active", rate: "12/hr" },
                { name: "Hacker News", status: "active", rate: "45/hr" },
                { name: "openai/whisper", status: "polling", rate: "0/hr" },
                { name: "X/AI-Safety", status: "damped", rate: "dam" },
              ].map((source, i) => (
                <div key={i} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      source.status === 'active' ? 'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]' :
                      source.status === 'damped' ? 'bg-rose-400' : 'bg-slate-600'
                    }`} />
                    <span className={`text-sm font-humanist ${source.status === 'damped' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                      {source.name}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-400 transition-colors">
                    {source.rate}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Open Tensions */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-500 font-mono mb-4 flex items-center gap-2">
              <Workflow className="w-3.5 h-3.5" /> Active Tensions
            </h2>
            <div className="space-y-3">
              <div className="p-3 bg-rose-950/20 border border-rose-500/20 rounded-md cursor-pointer hover:bg-rose-950/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-rose-400/80">TENS-092</span>
                  <span className="w-2 h-2 rounded-full border border-rose-500" />
                </div>
                <p className="text-xs text-slate-300 font-humanist leading-relaxed">
                  SAE architectural inevitability vs tooling artifact
                </p>
              </div>
              <div className="p-3 bg-amber-950/20 border border-amber-500/20 rounded-md cursor-pointer hover:bg-amber-950/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-amber-400/80">TENS-091</span>
                  <span className="w-2 h-2 rounded-full border border-amber-500" />
                </div>
                <p className="text-xs text-slate-300 font-humanist leading-relaxed">
                  Rate of capability gain exceeding eval development
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="p-6 border-t border-white/5 relative">
          <button className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded font-mono text-xs text-slate-300 transition-all flex items-center justify-center gap-2 group">
            <Zap className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-300" />
            Invoke Self-Build Loop
          </button>
        </div>
      </div>

      {/* Center: The Conversation Substrate */}
      <div className="flex-1 flex flex-col relative bg-[#0a0a0f]">
        {/* Subtle ambient gradient (replaces noise texture) */}
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ backgroundImage: 'radial-gradient(ellipse at top, rgba(99,102,241,0.08), transparent 60%), radial-gradient(ellipse at bottom right, rgba(245,158,11,0.05), transparent 60%)' }} />

        {/* Top Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 z-10 backdrop-blur-md bg-[#0a0a0f]/80">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
              <span className="text-xs font-mono text-emerald-400/80">COUNCIL ACTIVE</span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1.5"><ObserverSigil /> 12 Observers</span>
              <span className="flex items-center gap-1.5"><CouncilSigil /> 4 Nodes</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-slate-500 hover:text-slate-300 transition-colors">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Threaded Feed */}
        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8 z-10 scroll-smooth">
          <div className="max-w-3xl mx-auto space-y-10 pb-20">
            {messages.map((msg) => {
              const styles = {
                observer: { sigil: <ObserverSigil />, text: "text-indigo-100", border: "border-indigo-500/20", bg: "bg-indigo-500/5", font: "font-grotesk" },
                searcher: { sigil: <SearcherSigil />, text: "text-amber-100", border: "border-amber-500/20", bg: "bg-amber-500/5", font: "font-humanist" },
                council: { sigil: <CouncilSigil />, text: "text-emerald-100", border: "border-emerald-500/20", bg: "bg-emerald-500/5", font: "font-serif text-lg leading-relaxed" },
                spectral: { sigil: <SpectralSigil />, text: "text-fuchsia-100", border: "border-fuchsia-500/20", bg: "bg-fuchsia-500/5", font: "font-mono text-sm" },
                user: { sigil: <UserSigil />, text: "text-slate-200", border: "border-white/10", bg: "bg-white/5", font: "font-humanist" }
              }[msg.voice];

              return (
                <div key={msg.id} className={`flex gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ${msg.isComposing ? 'opacity-70' : ''}`}>
                  <div className="flex-shrink-0 mt-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${styles.border} ${styles.bg}`}>
                      {styles.sigil}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3 mb-2">
                      <span className="font-medium text-sm text-slate-300">{msg.name}</span>
                      <span className="text-[10px] font-mono text-slate-600">{msg.timestamp}</span>
                    </div>
                    <div className={`${styles.text} ${styles.font}`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Bottom Composer */}
        <div className="p-6 bg-gradient-to-t from-[#050508] via-[#050508]/90 to-transparent z-20">
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#0f0f16] border border-white/10 rounded-xl overflow-hidden shadow-2xl focus-within:border-white/20 transition-colors">
              <div className="flex px-4 py-2.5 border-b border-white/5 gap-2 overflow-x-auto no-scrollbar">
                {[
                  { id: "ask", label: "Ask", icon: SearchIcon, color: "text-amber-400", activeBg: "bg-amber-500/10 border-amber-500/30" },
                  { id: "watch", label: "Watch", icon: Eye, color: "text-indigo-400", activeBg: "bg-indigo-500/10 border-indigo-500/30" },
                  { id: "convene", label: "Convene", icon: BrainCircuit, color: "text-emerald-400", activeBg: "bg-emerald-500/10 border-emerald-500/30" },
                  { id: "probe", label: "Probe", icon: Activity, color: "text-fuchsia-400", activeBg: "bg-fuchsia-500/10 border-fuchsia-500/30" }
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id as any)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border transition-all ${
                      mode === m.id 
                        ? `${m.activeBg} ${m.color}` 
                        : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <m.icon className="w-3.5 h-3.5" />
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end p-2 pb-3">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={`${mode === 'ask' ? 'Decompose and search...' : mode === 'watch' ? 'Set observation parameters...' : mode === 'convene' ? 'Propose a topic for the council...' : 'Probe the spectral layer...'}`}
                  className="flex-1 bg-transparent border-0 resize-none max-h-32 min-h-[44px] text-sm text-slate-200 placeholder:text-slate-600 focus:ring-0 p-3 font-humanist"
                  rows={1}
                />
                <div className="p-2 flex-shrink-0">
                  <button 
                    onClick={handleSend}
                    disabled={!inputValue.trim()}
                    className="w-8 h-8 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:hover:bg-white/10 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Rail: Spectral Phase Metrics */}
      <div className="w-72 flex-shrink-0 border-l border-white/5 bg-white/[0.02] backdrop-blur-xl flex flex-col z-10 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-fuchsia-500/5 to-transparent pointer-events-none" />
        
        <div className="p-6 pb-4 border-b border-white/5 relative">
          <h2 className="text-xs uppercase tracking-widest text-fuchsia-400 font-mono flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Spectral Phase
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 relative">
          <div className="space-y-6">
            {/* Illumination Density */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Illumination (ID)</span>
                <span className="text-fuchsia-300">4.2</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-fuchsia-500 w-[65%] shadow-[0_0_8px_rgba(217,70,239,0.5)]"></div>
              </div>
            </div>

            {/* Mobility */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Mobility (MOB)</span>
                <span className="text-cyan-300">1.1</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 w-[30%]"></div>
              </div>
            </div>

            {/* Stagnation */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Stagnation (STG)</span>
                <span className="text-slate-500">0.05</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-slate-500 w-[5%]"></div>
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-white/5" />

          {/* Transit Medium Concept */}
          <section className="space-y-4">
            <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest">Transit Medium</h3>
            <div className="p-4 bg-black/20 border border-white/5 rounded-lg space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Conductance</span>
                <span className="font-mono text-emerald-400">0.84</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Backpressure</span>
                <span className="font-mono text-amber-400">Moderate</span>
              </div>
              <div className="pt-2 mt-2 border-t border-white/5">
                <p className="text-[10px] text-slate-500 leading-relaxed font-humanist">
                  A cognitive dam is forming around "Eval Capabilities". Recommend a Phase Kick operator to disperse the accumulation.
                </p>
              </div>
            </div>
          </section>

          {/* Recommended Operators */}
          <section>
            <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Operators</h3>
            <div className="space-y-2">
              <button className="w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group">
                <span className="block text-xs font-mono text-fuchsia-300 mb-1 group-hover:text-fuchsia-200">Collatz Kick</span>
                <span className="block text-[10px] text-slate-500">Inject structured entropy to break stagnation.</span>
              </button>
              <button className="w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group">
                <span className="block text-xs font-mono text-indigo-300 mb-1 group-hover:text-indigo-200">Temporal Splicer</span>
                <span className="block text-[10px] text-slate-500">Connect disconnected belief timelines.</span>
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
