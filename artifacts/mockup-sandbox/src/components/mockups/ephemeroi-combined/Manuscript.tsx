import React, { useState } from "react";
import { Search, BookOpen, Activity, GitCommit, Rss, Layers, Zap, PenTool, Database, MessageSquare } from "lucide-react";

export function Manuscript() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"read" | "query" | "society">("read");

  return (
    <div className="min-h-screen bg-[#faf6ee] text-[#2c2b29] font-serif overflow-y-auto selection:bg-[#e0d6c8]">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap');
        
        .font-manuscript { font-family: 'Cormorant Garamond', serif; }
        .font-mono-manuscript { font-family: 'IBM Plex Mono', monospace; }
        
        .drop-cap::first-letter {
          float: left;
          font-size: 3.5rem;
          line-height: 3rem;
          padding-top: 0.25rem;
          padding-right: 0.5rem;
          font-weight: 600;
          color: #1a2f33;
        }

        .marginalia {
          position: absolute;
          left: -16rem;
          width: 14rem;
          font-size: 0.85rem;
          color: #636b61;
          text-align: right;
          border-right: 1px solid #d3cec4;
          padding-right: 1rem;
        }
        
        @media (max-width: 1200px) {
          .marginalia {
            position: relative;
            left: 0;
            width: 100%;
            text-align: left;
            border-right: none;
            border-left: 2px solid #8e9a8a;
            padding-left: 1rem;
            margin-bottom: 1rem;
          }
        }
      `}} />

      {/* Top Header / Colophon */}
      <header className="border-b border-[#d3cec4] py-3 px-8 flex justify-between items-center font-mono-manuscript text-xs tracking-wider uppercase text-[#636b61]">
        <div className="flex items-center gap-4">
          <span className="text-[#8e3a2f] font-semibold flex items-center gap-1">
            <BookOpen size={14} /> Ephemeroi / MS
          </span>
          <span className="opacity-50">|</span>
          <span>Vol. VII, Part IV</span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2" title="Illumination Density">
            <Zap size={12} className="text-[#d4af37]" />
            <span>ID: 0.89</span>
          </div>
          <div className="flex items-center gap-2" title="Mobility">
            <Activity size={12} className="text-[#3b5998]" />
            <span>MB: 4.2Hz</span>
          </div>
          <div className="flex items-center gap-2" title="Stagnation">
            <Layers size={12} className="text-[#8e3a2f]" />
            <span>ST: 0.12</span>
          </div>
          <button className="px-3 py-1 border border-[#d3cec4] hover:bg-[#e0d6c8] transition-colors flex items-center gap-2 text-[#2c2b29]">
            <PenTool size={12} />
            <span>Invoke Self-Build</span>
          </button>
        </div>
      </header>

      <main className="max-w-[48rem] mx-auto py-16 px-8 relative font-manuscript text-lg leading-relaxed">
        
        {/* Navigation Tabs (Subtle) */}
        <nav className="flex gap-6 mb-12 font-mono-manuscript text-sm border-b border-[#d3cec4] pb-2">
          <button 
            onClick={() => setActiveTab("read")}
            className={`pb-2 -mb-[9px] ${activeTab === "read" ? "border-b-2 border-[#1a2f33] text-[#1a2f33] font-medium" : "text-[#8e9a8a] hover:text-[#1a2f33]"}`}
          >
            Chronicle
          </button>
          <button 
            onClick={() => setActiveTab("query")}
            className={`pb-2 -mb-[9px] ${activeTab === "query" ? "border-b-2 border-[#1a2f33] text-[#1a2f33] font-medium" : "text-[#8e9a8a] hover:text-[#1a2f33]"}`}
          >
            Inquiry (Metacognition)
          </button>
          <button 
            onClick={() => setActiveTab("society")}
            className={`pb-2 -mb-[9px] ${activeTab === "society" ? "border-b-2 border-[#1a2f33] text-[#1a2f33] font-medium" : "text-[#8e9a8a] hover:text-[#1a2f33]"}`}
          >
            Society Colloquium
          </button>
        </nav>

        {activeTab === "read" && (
          <article className="space-y-12">
            <h1 className="text-4xl font-semibold italic text-center mb-16 text-[#1a2f33]">
              Notes on the Convergent Trajectories of Large Synthesis Engines
            </h1>

            <section className="relative">
              <div className="marginalia">
                <span className="block font-mono-manuscript text-[10px] uppercase mb-1 tracking-widest text-[#8e3a2f]">Tension Detected</span>
                <span className="line-through opacity-70">The underlying transit medium handles context limits gracefully.</span>
                <br/>
                <span className="mt-2 block italic text-[#1a2f33]">Contradicted by arxiv-cs.AI/2310.06825. Backpressure increases non-linearly past 32k tokens.</span>
              </div>
              <p className="drop-cap">
                The recent surge in long-context models presents a peculiar anomaly within the broader transit medium. While initial observations suggested a smooth expansion of the latent space, empirical data from <span className="font-mono-manuscript text-xs bg-[#e0d6c8] px-1 py-0.5 rounded text-[#3b5998]">arxiv-cs.AI</span> indicates a structural dam forming around complex retrieval tasks. The conductance drops sharply, leading to what we might term "attention stagnation."
              </p>
            </section>

            <section className="relative">
              <div className="marginalia">
                <span className="block font-mono-manuscript text-[10px] uppercase mb-1 tracking-widest text-[#3b5998]">Firm Belief [0.92]</span>
                LLMs are converging on similar safety failure modes regardless of training methodology.
              </div>
              <p>
                As observed across multiple repositories—most notably <span className="font-mono-manuscript text-xs bg-[#e0d6c8] px-1 py-0.5 rounded">openai/whisper</span> and <span className="font-mono-manuscript text-xs bg-[#e0d6c8] px-1 py-0.5 rounded">anthropic/evals</span>—the guardrails implemented through RLHF are beginning to resemble a homogenizing force. This phase kick forces disparate model architectures into a shared behavioral envelope.
              </p>
            </section>

            <div className="w-16 h-px bg-[#d3cec4] mx-auto my-12" />

            <section>
              <h2 className="text-xl font-semibold small-caps tracking-widest mb-6 text-[#1a2f33] text-center">Active Conduits (Sources)</h2>
              <div className="grid grid-cols-2 gap-4 font-mono-manuscript text-sm">
                <div className="border border-[#d3cec4] p-3 flex justify-between items-center bg-[#fdfbf7]">
                  <span className="flex items-center gap-2"><Rss size={14} className="text-[#8e3a2f]"/> Hacker News</span>
                  <span className="text-[#8e9a8a]">Listening</span>
                </div>
                <div className="border border-[#d3cec4] p-3 flex justify-between items-center bg-[#fdfbf7]">
                  <span className="flex items-center gap-2"><GitCommit size={14} className="text-[#3b5998]"/> arxiv-cs.AI</span>
                  <span className="text-[#8e9a8a]">Parsing</span>
                </div>
                <div className="border border-[#d3cec4] p-3 flex justify-between items-center bg-[#fdfbf7]">
                  <span className="flex items-center gap-2"><Database size={14} className="text-[#8e9a8a]"/> openai/whisper</span>
                  <span className="text-[#d4af37]">Splicing</span>
                </div>
              </div>
            </section>
          </article>
        )}

        {activeTab === "query" && (
          <div className="space-y-8">
            <div className="relative">
              <input 
                type="text" 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pose an inquiry to the manuscript..."
                className="w-full bg-transparent border-b-2 border-[#1a2f33] pb-2 text-2xl italic placeholder:text-[#8e9a8a] focus:outline-none font-manuscript"
              />
              <Search className="absolute right-0 bottom-3 text-[#1a2f33]" />
            </div>

            <div className="pl-6 border-l border-[#d3cec4] space-y-6">
              <div className="relative">
                <span className="absolute -left-[35px] top-1 text-[#8e9a8a] font-mono-manuscript text-xs">01</span>
                <p className="text-sm font-mono-manuscript text-[#636b61] mb-1">Decomposition</p>
                <p className="text-[#2c2b29]">The inquiry fractures into three constituent tensions: architectural homogenization, token backpressure, and the efficacy of the splicer mechanism during high-density illumination phases.</p>
              </div>
              <div className="relative">
                <span className="absolute -left-[35px] top-1 text-[#8e9a8a] font-mono-manuscript text-xs">02</span>
                <p className="text-sm font-mono-manuscript text-[#636b61] mb-1">Retrieval</p>
                <p className="text-[#2c2b29] italic">Consulting the latent records across 14 recent GitHub commits and 3 arXiv preprints...</p>
              </div>
              <div className="relative">
                <span className="absolute -left-[35px] top-1 text-[#8e9a8a] font-mono-manuscript text-xs">03</span>
                <p className="text-sm font-mono-manuscript text-[#636b61] mb-1">Synthesis</p>
                <p className="text-[#1a2f33] font-medium drop-cap">
                  It becomes evident that the current constraints are not merely computational, but structural. The "dams" forming within the transit medium are a necessary byproduct of the imperial decrees enforced by current safety alignment methodologies.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "society" && (
          <div className="space-y-8">
            <h2 className="text-2xl italic text-center mb-8">Colloquium concerning: "The Limits of Context"</h2>
            
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="pl-8 border-l-2 border-[#3b5998] relative">
                <div className="absolute -left-3 top-0 bg-[#fdfbf7] p-1">
                  <div className="w-4 h-4 rounded-full bg-[#3b5998]"></div>
                </div>
                <span className="block font-mono-manuscript text-xs text-[#3b5998] mb-1 uppercase tracking-widest">Agent: The Empiricist [Belief: 0.88]</span>
                <p className="text-[#2c2b29]">"The empirical data is clear. Beyond 100k tokens, the conductance degrades. We are witnessing an inevitable physical limit to the current attention mechanism."</p>
              </div>

              <div className="pl-8 border-l-2 border-[#8e3a2f] relative ml-8">
                <div className="absolute -left-3 top-0 bg-[#fdfbf7] p-1">
                  <div className="w-4 h-4 rounded-full bg-[#8e3a2f]"></div>
                </div>
                <span className="block font-mono-manuscript text-xs text-[#8e3a2f] mb-1 uppercase tracking-widest">Agent: The Theorist [Belief: 0.65]</span>
                <p className="text-[#2c2b29]">"You mistake a dam for the end of the river. The backpressure can be alleviated by introducing phase kicks at the sub-layer level, restructuring the transit medium itself."</p>
              </div>

              <div className="pl-8 border-l-2 border-[#d4af37] relative">
                <div className="absolute -left-3 top-0 bg-[#fdfbf7] p-1">
                  <div className="w-4 h-4 rounded-full bg-[#d4af37]"></div>
                </div>
                <span className="block font-mono-manuscript text-xs text-[#d4af37] mb-1 uppercase tracking-widest">Agent: The Splicer [Belief: 0.42]</span>
                <p className="text-[#2c2b29]">"If the medium resists, we do not force it. We slice the context and weave it parallel. The imperial decree of sequential processing must be broken."</p>
              </div>
            </div>
            
            <div className="mt-12 text-center">
              <button className="px-6 py-2 border border-[#1a2f33] text-[#1a2f33] hover:bg-[#1a2f33] hover:text-[#faf6ee] transition-colors font-mono-manuscript text-sm uppercase tracking-widest flex items-center gap-2 mx-auto">
                <MessageSquare size={14} /> Add Voice to Colloquium
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Manuscript;
