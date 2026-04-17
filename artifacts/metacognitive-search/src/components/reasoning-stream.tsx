import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  StreamEvent,
  DecomposePayload,
  RetrievePayload,
  EvaluatePayload,
  PivotPayload,
  SynthesizePayload,
  WebSearchPayload,
  PatternPayload,
  ReflectPayload,
} from "@/hooks/use-search-stream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, BookOpen, Brain, CheckCircle, ChevronRight,
  ExternalLink, Globe, Layers, Lightbulb, Microscope, Search, Sparkles, Zap,
} from "lucide-react";

interface ReasoningStreamProps {
  events: StreamEvent[];
  liveTokenStream: string;
  isRunning: boolean;
}

export function ReasoningStream({ events, liveTokenStream, isRunning }: ReasoningStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, liveTokenStream]);

  if (events.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground">
        <Microscope className="h-12 w-12 mb-4 opacity-20" />
        <h2 className="text-lg font-medium text-foreground mb-2">Metacognitive Search Console</h2>
        <p className="text-sm max-w-md">
          Submit a research question, paste code for review, or run a real web search with cross-source pattern detection — and watch the AI reason about its own process in real time.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-4 overflow-y-auto h-full pr-2 pb-8 scroll-smooth"
      data-testid="container-reasoning-stream"
    >
      <AnimatePresence initial={false}>
        {events.map((event, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {renderEvent(event)}
          </motion.div>
        ))}
      </AnimatePresence>

      {isRunning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-500 animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Processing</span>
          </div>
          {liveTokenStream && (
            <Card className="bg-card/50 border-dashed border-border/50">
              <CardContent className="p-4 font-mono text-sm text-foreground/80 whitespace-pre-wrap">
                {liveTokenStream}
                <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse" />
              </CardContent>
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}

function renderEvent(event: StreamEvent) {
  if (event.type === 'started') {
    return (
      <div className="flex items-center gap-3 text-muted-foreground py-2" data-testid="stream-event-started">
        <div className="h-px bg-border flex-1" />
        <span className="text-xs font-mono uppercase tracking-widest text-primary">Session Initiated</span>
        <div className="h-px bg-border flex-1" />
      </div>
    );
  }

  if (event.type === 'complete') {
    return (
      <div className="flex items-center gap-3 text-muted-foreground py-6" data-testid="stream-event-complete">
        <div className="h-px bg-border flex-1" />
        <CheckCircle className="h-5 w-5 text-emerald-500" />
        <span className="text-xs font-mono uppercase tracking-widest text-emerald-500">Synthesis Complete</span>
        <div className="h-px bg-border flex-1" />
      </div>
    );
  }

  if (event.type === 'error') {
    return (
      <Card className="border-l-4 border-l-rose-500 bg-rose-500/5" data-testid="stream-event-error">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-rose-400 mb-1">Search Error</p>
            <p className="text-sm text-rose-300/80">{event.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (event.type === 'step') {
    switch (event.stepType) {
      case 'DECOMPOSE': return renderDecompose(event.data as DecomposePayload);
      case 'RETRIEVE': return renderRetrieve(event.data as RetrievePayload);
      case 'EVALUATE': return renderEvaluate(event.data as EvaluatePayload);
      case 'PIVOT': return renderPivot(event.data as PivotPayload);
      case 'SYNTHESIZE': return renderSynthesize(event.data as SynthesizePayload);
      case 'WEB_SEARCH': return renderWebSearch(event.data as WebSearchPayload);
      case 'PATTERN': return renderPattern(event.data as PatternPayload);
      case 'REFLECT': return renderReflect(event.data as ReflectPayload);
      default: return null;
    }
  }

  return null;
}

function renderDecompose(d: DecomposePayload) {
  return (
    <Card className="border-l-4 border-l-indigo-500 bg-card overflow-hidden" data-testid="stream-step-decompose">
      <CardHeader className="bg-indigo-500/10 pb-2 py-3 px-4 flex flex-row items-center gap-2">
        <Brain className="h-4 w-4 text-indigo-500" />
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-indigo-400">Decompose</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ul className="space-y-2">
          {d.subQuestions?.map((sq, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <ChevronRight className="h-4 w-4 mt-0.5 text-indigo-500/50 shrink-0" />
              <span>{sq}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function renderRetrieve(d: RetrievePayload) {
  return (
    <Card className="border-l-4 border-l-emerald-500 bg-card overflow-hidden" data-testid="stream-step-retrieve">
      <CardHeader className="bg-emerald-500/10 pb-2 py-3 px-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-emerald-500" />
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-emerald-400">Knowledge Retrieval</CardTitle>
        </div>
        {d.sourceType && (
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10 text-[10px]">
            {d.sourceType}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {d.subQuestion && (
          <div className="text-xs text-muted-foreground italic">{d.subQuestion}</div>
        )}
        {d.confidence !== undefined && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>Source Confidence</span>
              <span>{Math.round(d.confidence * 100)}%</span>
            </div>
            <Progress value={d.confidence * 100} className="h-1 bg-emerald-950" indicatorClassName="bg-emerald-500" />
          </div>
        )}
        {d.findings && (
          <div className="text-sm bg-muted/50 p-3 rounded border border-border/50 whitespace-pre-wrap">
            {d.findings}
          </div>
        )}
        {d.references && d.references.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> References
            </h4>
            <ul className="text-xs space-y-1 text-muted-foreground">
              {d.references.map((ref, i) => (
                <li key={i} className="truncate" title={ref}>[{i+1}] {ref}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderEvaluate(d: EvaluatePayload) {
  return (
    <Card className="border-l-4 border-l-amber-500 bg-card overflow-hidden" data-testid="stream-step-evaluate">
      <CardHeader className="bg-amber-500/10 pb-2 py-3 px-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-amber-400">Coverage Evaluation</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {d.overallConfidence !== undefined && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>Overall Coverage</span>
              <span>{Math.round(d.overallConfidence * 100)}%</span>
            </div>
            <Progress value={d.overallConfidence * 100} className="h-1 bg-amber-950" indicatorClassName="bg-amber-500" />
          </div>
        )}
        {d.gaps && d.gaps.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-amber-500 uppercase mb-2">Identified Gaps / Issues</h4>
            <ul className="space-y-1">
              {d.gaps.map((gap, i) => (
                <li key={i} className="text-sm text-foreground flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <span>{gap}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderPivot(d: PivotPayload) {
  return (
    <Card className="border-l-4 border-l-rose-500 bg-card overflow-hidden" data-testid="stream-step-pivot">
      <CardHeader className="bg-rose-500/10 pb-2 py-3 px-4 flex flex-row items-center gap-2">
        <Zap className="h-4 w-4 text-rose-500" />
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-rose-400">Strategy Pivot</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 text-sm font-mono bg-rose-500/5 p-3 rounded border border-rose-500/20">
          <div className="text-muted-foreground line-through decoration-rose-500/50">{d.oldDirection}</div>
          <div className="text-rose-500 hidden md:block">→</div>
          <div className="text-rose-500 font-bold">{d.newDirection}</div>
        </div>
        {d.rationale && (
          <div className="text-sm border-l-2 border-rose-500/30 pl-3 py-1 italic text-muted-foreground">
            "{d.rationale}"
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderSynthesize(d: SynthesizePayload) {
  return (
    <Card className="border-l-4 border-l-violet-500 bg-card overflow-hidden shadow-lg border-t border-r border-b border-violet-500/20" data-testid="stream-step-synthesize">
      <CardHeader className="bg-violet-500/10 pb-2 py-4 px-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Microscope className="h-5 w-5 text-violet-500" />
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-violet-400 font-bold">Final Synthesis</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-5 space-y-6">
        {d.finalConfidence !== undefined && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>Synthesized Answer Confidence</span>
              <span className="text-violet-400 font-bold">{Math.round(d.finalConfidence * 100)}%</span>
            </div>
            <Progress value={d.finalConfidence * 100} className="h-1.5 bg-violet-950" indicatorClassName="bg-violet-500" />
          </div>
        )}
        {d.answer && <SynthesizedAnswer answer={d.answer} />}
        {d.keyFindings && d.keyFindings.length > 0 && (
          <div>
            <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Key Findings</h4>
            <ul className="text-sm space-y-1 text-foreground">
              {d.keyFindings.map((kf, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-violet-500/70 mt-0.5">▸</span>
                  <span>{kf}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(d.openQuestions?.length > 0 || d.furtherReading?.length > 0) && (
          <Separator className="bg-violet-500/20" />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.openQuestions && d.openQuestions.length > 0 && (
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Open Questions</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                {d.openQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-violet-500/50 mt-0.5">?</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.furtherReading && d.furtherReading.length > 0 && (
            <div>
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Further Reading</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                {d.furtherReading.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <BookOpen className="h-3.5 w-3.5 text-violet-500/50 mt-0.5 shrink-0" />
                    <span className="truncate" title={item}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Renders synthesis text, splitting out fenced code blocks (```lang\n...\n```)
// so refactored code in code-review mode is shown in a proper code panel.
function SynthesizedAnswer({ answer }: { answer: string }) {
  const parts: Array<{ kind: 'text' | 'code'; lang?: string; content: string }> = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: 'text', content: answer.slice(lastIdx, m.index) });
    }
    parts.push({ kind: 'code', lang: m[1] || 'text', content: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < answer.length) {
    parts.push({ kind: 'text', content: answer.slice(lastIdx) });
  }

  if (parts.length === 0) {
    return <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{answer}</div>;
  }

  return (
    <div className="space-y-3">
      {parts.map((part, i) => part.kind === 'code' ? (
        <div key={i} className="rounded border border-violet-500/20 bg-black/40 overflow-hidden">
          <div className="px-3 py-1.5 bg-violet-500/10 border-b border-violet-500/20 text-[10px] font-mono uppercase tracking-wider text-violet-300 flex items-center justify-between">
            <span>{part.lang || 'code'}</span>
            <span className="text-violet-400/60">refactored output</span>
          </div>
          <pre className="p-3 text-xs font-mono text-emerald-200/90 overflow-x-auto whitespace-pre">{part.content}</pre>
        </div>
      ) : (
        part.content.trim() && (
          <div key={i} className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{part.content.trim()}</div>
        )
      ))}
    </div>
  );
}

function renderWebSearch(d: WebSearchPayload) {
  return (
    <Card className="border-l-4 border-l-cyan-500 bg-card overflow-hidden" data-testid="stream-step-web-search">
      <CardHeader className="bg-cyan-500/10 pb-2 py-3 px-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-cyan-500" />
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-cyan-400">Live Web Sources</CardTitle>
        </div>
        <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10 text-[10px]">
          {d.totalSources} sources
        </Badge>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <div className="text-xs font-mono text-muted-foreground">
          query: <span className="text-cyan-400">{d.query}</span>
        </div>
        <ul className="space-y-2">
          {d.sources.map((src) => {
            const isSafeUrl = /^https?:\/\//i.test(src.url);
            return (
            <li key={src.index} className="flex items-start gap-2 text-sm border border-border/40 rounded p-2 bg-muted/20">
              <span className="text-cyan-500 font-mono text-xs shrink-0 mt-0.5">[{src.index}]</span>
              <div className="min-w-0 flex-1">
                {isSafeUrl ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:text-cyan-200 hover:underline text-sm font-medium flex items-center gap-1"
                  >
                    <span className="truncate">{src.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                  </a>
                ) : (
                  <span className="text-muted-foreground text-sm font-medium truncate block" title={src.url}>{src.title}</span>
                )}
                <div className="text-[10px] font-mono text-muted-foreground truncate">{src.url}</div>
                {src.snippet && (
                  <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{src.snippet}</div>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function renderPattern(d: PatternPayload) {
  const maxFreq = Math.max(1, ...d.patterns.map(p => p.frequency));
  return (
    <Card className="border-l-4 border-l-fuchsia-500 bg-card overflow-hidden" data-testid="stream-step-pattern">
      <CardHeader className="bg-fuchsia-500/10 pb-2 py-3 px-4 flex flex-row items-center gap-2">
        <Layers className="h-4 w-4 text-fuchsia-500" />
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-fuchsia-400">Cross-Source Patterns</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {d.dominantThemes && d.dominantThemes.length > 0 && (
          <div>
            <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Dominant Themes</h4>
            <div className="flex flex-wrap gap-1.5">
              {d.dominantThemes.map((t, i) => (
                <Badge key={i} className="bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/20">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {d.patterns && d.patterns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Detected Patterns</h4>
            {d.patterns.map((p, i) => (
              <div key={i} className="border border-border/40 rounded p-2 bg-muted/20">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-foreground">{p.theme}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">×{p.frequency}</span>
                </div>
                <div className="h-1 bg-fuchsia-950 rounded overflow-hidden">
                  <div className="h-full bg-fuchsia-500" style={{ width: `${(p.frequency / maxFreq) * 100}%` }} />
                </div>
                {p.supportingSources && p.supportingSources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.supportingSources.map((s) => (
                      <span key={s} className="text-[10px] font-mono text-fuchsia-400/80 bg-fuchsia-500/10 px-1.5 rounded">[{s}]</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {d.outliers && d.outliers.length > 0 && (
          <div>
            <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Outliers</h4>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {d.outliers.map((o, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-fuchsia-500/60">•</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderReflect(d: ReflectPayload) {
  return (
    <Card
      className="border-l-4 border-l-amber-400 bg-gradient-to-br from-amber-500/5 via-card to-card overflow-hidden"
      data-testid="stream-step-reflect"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <CardTitle className="text-xs font-mono uppercase tracking-widest text-amber-300/90">
            REFLECT · Personal Thoughts &amp; Autonomous Exploration
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-l-2 border-amber-400/40 pl-3 italic text-foreground/90 text-sm leading-relaxed">
          {d.personalSummary}
        </div>

        {d.interestingObservations?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-mono flex items-center gap-1.5">
              <Lightbulb className="h-3 w-3 text-amber-400" /> What Struck Me
            </p>
            <ul className="space-y-1.5 text-sm text-foreground/85">
              {d.interestingObservations.map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-400/70 shrink-0 mt-0.5">◆</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {d.autonomousExplorations?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-mono flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-amber-400" /> If Given Autonomy, I'd Explore
            </p>
            <ul className="space-y-1.5">
              {d.autonomousExplorations.map((e, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-foreground/85 border border-amber-500/20 bg-amber-500/5 rounded p-2"
                >
                  <span className="text-amber-400 font-mono text-xs shrink-0 mt-0.5">→</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {d.selfAssessment && (
          <div className="pt-2 border-t border-border/40">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 font-mono">
              Self-Assessment
            </p>
            <p className="text-xs text-muted-foreground/90 leading-relaxed italic">
              {d.selfAssessment}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
