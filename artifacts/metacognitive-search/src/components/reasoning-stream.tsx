import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StreamEvent, DecomposePayload, RetrievePayload, EvaluatePayload, PivotPayload, SynthesizePayload } from "@/hooks/use-search-stream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, BookOpen, Brain, CheckCircle, ChevronRight, Microscope, Search, Zap } from "lucide-react";

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
          This instrument allows you to observe an AI reasoning about its search strategy in real-time. 
          Submit a query to watch it decompose questions, retrieve knowledge, evaluate coverage, pivot strategies, and synthesize answers.
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
            {renderEvent(event, index)}
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

function renderEvent(event: StreamEvent, index: number) {
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
      <div className="flex items-center gap-3 py-4" data-testid="stream-event-error">
        <div className="h-px bg-border flex-1" />
        <AlertTriangle className="h-5 w-5 text-rose-500" />
        <span className="text-xs font-mono uppercase tracking-widest text-rose-500">Search Error</span>
        <div className="h-px bg-border flex-1" />
        <span className="sr-only">{event.message}</span>
      </div>
    );
  }

  if (event.type === 'step') {
    switch (event.stepType) {
      case 'DECOMPOSE': {
        const d = event.data as DecomposePayload;
        return (
          <Card className="border-l-4 border-l-indigo-500 bg-card overflow-hidden" data-testid="stream-step-decompose">
            <CardHeader className="bg-indigo-500/10 pb-2 py-3 px-4 flex flex-row items-center gap-2">
              <Brain className="h-4 w-4 text-indigo-500" />
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-indigo-400">Decompose Query</CardTitle>
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
        
      case 'RETRIEVE': {
        const d = event.data as RetrievePayload;
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
        
      case 'EVALUATE': {
        const d = event.data as EvaluatePayload;
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
                    <span>Current Knowledge Coverage</span>
                    <span>{Math.round(d.overallConfidence * 100)}%</span>
                  </div>
                  <Progress value={d.overallConfidence * 100} className="h-1 bg-amber-950" indicatorClassName="bg-amber-500" />
                </div>
              )}
              
              {d.gaps && d.gaps.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-amber-500 uppercase mb-2">Identified Gaps</h4>
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
        
      case 'PIVOT': {
        const d = event.data as PivotPayload;
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
        
      case 'SYNTHESIZE': {
        const d = event.data as SynthesizePayload;
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
              
              {d.answer && (
                <div className="prose prose-invert prose-sm max-w-none text-foreground leading-relaxed whitespace-pre-wrap">
                  {d.answer}
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
        
      default:
        return null;
    }
  }

  return null;
}