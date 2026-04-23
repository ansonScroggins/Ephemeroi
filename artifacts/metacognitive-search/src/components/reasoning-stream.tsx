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
import {
  AlertTriangle, ExternalLink, Globe, Layers,
  Lightbulb, Search, Sparkles, Wand2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatFeedProps {
  query: string;
  events: StreamEvent[];
  liveTokenStream: string;
  isRunning: boolean;
  activeStepType: string | null;
}

const STEP_LABEL: Record<string, { label: string; Icon: typeof Search }> = {
  WEB_SEARCH: { label: "I'm searching the web", Icon: Globe },
  DECOMPOSE: { label: "Let me break this down", Icon: Wand2 },
  PATTERN: { label: "I see patterns across sources", Icon: Layers },
  RETRIEVE: { label: "Digging in", Icon: Search },
  EVALUATE: { label: "Checking what I have", Icon: AlertTriangle },
  PIVOT: { label: "Wait, let me try another angle", Icon: Zap },
  SYNTHESIZE: { label: "Here's my answer", Icon: Sparkles },
  REFLECT: { label: "One more thing — my honest take", Icon: Lightbulb },
};

export function ChatFeed({
  query, events, liveTokenStream, isRunning, activeStepType,
}: ChatFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events, liveTokenStream, isRunning]);

  const hasContent = events.length > 0 || isRunning || !!query;

  if (!hasContent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-2xl shadow-primary/30 mb-4">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <h2 className="text-base font-semibold mb-1">Hey, I'm Metacog</h2>
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
          Ask me anything. I'll think it through out loud — break it apart, dig in, and tell you what I actually think.
        </p>
        <div className="flex items-center gap-1.5 mt-4 text-[10px] text-muted-foreground/70">
          <span className="px-2 py-0.5 rounded-full bg-muted/40">Think</span>
          <span className="px-2 py-0.5 rounded-full bg-muted/40">Code</span>
          <span className="px-2 py-0.5 rounded-full bg-muted/40">Web</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-2 scroll-smooth"
      data-testid="container-reasoning-stream"
    >
      {/* User's message */}
      {query && <UserBubble text={query} />}

      <AnimatePresence initial={false}>
        {events.map((event, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {renderEvent(event)}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Typing indicator */}
      {isRunning && (
        <TypingIndicator
          label={activeStepType ? STEP_LABEL[activeStepType]?.label : null}
          tokenPreview={liveTokenStream}
        />
      )}
    </div>
  );
}

function renderEvent(event: StreamEvent): React.ReactNode {
  if (event.type === 'started') return null;

  if (event.type === 'complete') {
    return (
      <div className="flex justify-center my-2" data-testid="banner-complete">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-mono">
          delivered
        </span>
      </div>
    );
  }

  if (event.type === 'error') {
    return (
      <AiBubble accent="rose" testId="stream-event-error">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-200/90">{event.message}</p>
        </div>
      </AiBubble>
    );
  }

  if (event.type === 'step') {
    switch (event.stepType) {
      case 'DECOMPOSE': return <DecomposeBubble d={event.data as DecomposePayload} />;
      case 'RETRIEVE': return <RetrieveBubble d={event.data as RetrievePayload} />;
      case 'EVALUATE': return <EvaluateBubble d={event.data as EvaluatePayload} />;
      case 'PIVOT': return <PivotBubble d={event.data as PivotPayload} />;
      case 'SYNTHESIZE': return <SynthesizeBubble d={event.data as SynthesizePayload} />;
      case 'WEB_SEARCH': return <WebSearchBubble d={event.data as WebSearchPayload} />;
      case 'PATTERN': return <PatternBubble d={event.data as PatternPayload} />;
      case 'REFLECT': return <ReflectBubble d={event.data as ReflectPayload} />;
      default: return null;
    }
  }
  return null;
}

// ───────────── Generic bubbles ─────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end px-1" data-testid="bubble-user">
      <div className="max-w-[80%] rounded-3xl rounded-br-md bg-primary text-primary-foreground px-4 py-2 text-sm shadow-sm whitespace-pre-wrap break-words">
        {text}
      </div>
    </div>
  );
}

interface AiBubbleProps {
  children: React.ReactNode;
  label?: string;
  Icon?: typeof Search;
  accent?: 'default' | 'rose' | 'cyan' | 'fuchsia' | 'amber' | 'emerald' | 'violet' | 'rose-pivot';
  testId?: string;
}

const ACCENT_RING: Record<NonNullable<AiBubbleProps['accent']>, string> = {
  default: "",
  rose: "border-rose-500/30",
  cyan: "border-cyan-500/30",
  fuchsia: "border-fuchsia-500/30",
  amber: "border-amber-400/40",
  emerald: "border-emerald-500/30",
  violet: "border-violet-500/30",
  'rose-pivot': "border-rose-400/30",
};

const ACCENT_LABEL_COLOR: Record<NonNullable<AiBubbleProps['accent']>, string> = {
  default: "text-muted-foreground",
  rose: "text-rose-300",
  cyan: "text-cyan-300",
  fuchsia: "text-fuchsia-300",
  amber: "text-amber-300",
  emerald: "text-emerald-300",
  violet: "text-violet-300",
  'rose-pivot': "text-rose-300",
};

function AiBubble({ children, label, Icon, accent = 'default', testId }: AiBubbleProps) {
  return (
    <div className="flex flex-col items-start px-1 gap-1" data-testid={testId}>
      {label && (
        <div className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-mono pl-3", ACCENT_LABEL_COLOR[accent])}>
          {Icon && <Icon className="h-3 w-3" />}
          {label}
        </div>
      )}
      <div className={cn(
        "max-w-[85%] rounded-3xl rounded-bl-md bg-card/80 border px-4 py-2.5 text-sm shadow-sm",
        ACCENT_RING[accent],
      )}>
        {children}
      </div>
    </div>
  );
}

// ───────────── Step bubbles ─────────────

function DecomposeBubble({ d }: { d: DecomposePayload }) {
  return (
    <AiBubble label={STEP_LABEL.DECOMPOSE.label} Icon={STEP_LABEL.DECOMPOSE.Icon} accent="violet" testId="stream-step-decompose">
      <p className="text-foreground/95 leading-relaxed mb-2">{d.rationale}</p>
      <div className="flex flex-col gap-1.5">
        {d.subQuestions.map((q, i) => (
          <div key={i} className="flex items-start gap-2 text-foreground/85 text-[13px]">
            <span className="text-violet-400 font-mono text-xs mt-0.5">{i + 1}.</span>
            <span>{q}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground/70 mt-2 font-mono">
        strategy: {d.strategy.replace('_', ' ')}
      </div>
    </AiBubble>
  );
}

const LENS_STYLE: Record<string, { color: string; label: string; emoji: string }> = {
  VISIBLE:  { color: "text-slate-200 border-slate-400/40 bg-slate-400/10", label: "visible", emoji: "◐" },
  INFRARED: { color: "text-rose-200 border-rose-400/40 bg-rose-400/10",     label: "infrared", emoji: "▼" },
  UV:       { color: "text-violet-200 border-violet-400/40 bg-violet-400/10", label: "uv", emoji: "◆" },
  PRISM:    { color: "text-fuchsia-200 border-fuchsia-400/40 bg-fuchsia-400/10", label: "prism", emoji: "✦" },
};

function RetrieveBubble({ d }: { d: RetrievePayload }) {
  const lens = d.lens && LENS_STYLE[d.lens] ? LENS_STYLE[d.lens] : null;
  return (
    <AiBubble label={`${STEP_LABEL.RETRIEVE.label} · ${d.subQuestion}`} Icon={STEP_LABEL.RETRIEVE.Icon} accent="emerald" testId="stream-step-retrieve">
      {lens && (
        <div className={cn("inline-flex items-center gap-1 text-[10px] font-mono mb-1.5 px-2 py-0.5 rounded-full border", lens.color)} data-testid={`lens-${d.lens?.toLowerCase()}`}>
          <span>{lens.emoji}</span>
          <span className="uppercase tracking-wider">{lens.label} lens</span>
        </div>
      )}
      <p className="text-foreground/95 leading-relaxed">{d.findings}</p>
      {d.lensRationale && (
        <p className="text-[11px] text-muted-foreground/80 italic mt-1.5 leading-snug">
          ↳ {d.lensRationale}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-muted-foreground">
        <span className="px-1.5 py-0.5 rounded bg-muted/60">{d.sourceType}</span>
        <span>confidence {(d.confidence * 100).toFixed(0)}%</span>
      </div>
      {d.references.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">refs</div>
          <ul className="space-y-0.5">
            {d.references.map((r, i) => (
              <li key={i} className="text-[11px] text-muted-foreground/90 truncate" title={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}
    </AiBubble>
  );
}

function EvaluateBubble({ d }: { d: EvaluatePayload }) {
  return (
    <AiBubble label={STEP_LABEL.EVALUATE.label} Icon={STEP_LABEL.EVALUATE.Icon} accent="amber" testId="stream-step-evaluate">
      <p className="text-foreground/95 leading-relaxed mb-2">{d.coverageAssessment}</p>
      {d.gaps.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-mono">things I don't fully know</div>
          {d.gaps.map((g, i) => (
            <div key={i} className="text-[13px] text-foreground/85 flex gap-2">
              <span className="text-amber-400/70">·</span>
              <span>{g}</span>
            </div>
          ))}
        </div>
      )}
      {d.conflictDetected && d.conflictDescription && (
        <div className="mt-2 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-[12px] text-rose-200">
          ⚡ conflict: {d.conflictDescription}
        </div>
      )}
      <div className="text-[10px] mt-2 font-mono text-muted-foreground">
        overall confidence {(d.overallConfidence * 100).toFixed(0)}%
      </div>
    </AiBubble>
  );
}

function PivotBubble({ d }: { d: PivotPayload }) {
  return (
    <AiBubble label={STEP_LABEL.PIVOT.label} Icon={STEP_LABEL.PIVOT.Icon} accent="rose-pivot" testId="stream-step-pivot">
      <p className="text-foreground/95 leading-relaxed mb-2">{d.rationale}</p>
      <div className="text-[12px] text-muted-foreground space-y-0.5">
        <div><span className="line-through text-muted-foreground/60">{d.oldDirection}</span></div>
        <div className="text-foreground/85">→ {d.newDirection}</div>
      </div>
    </AiBubble>
  );
}

function SynthesizeBubble({ d }: { d: SynthesizePayload }) {
  // Split fenced code blocks if present
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const fenceRegex = /```(\w+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(d.answer))) {
    if (m.index > last) parts.push({ type: 'text', content: d.answer.slice(last, m.index).trim() });
    parts.push({ type: 'code', lang: m[1] ?? 'js', content: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < d.answer.length) parts.push({ type: 'text', content: d.answer.slice(last).trim() });
  if (parts.length === 0) parts.push({ type: 'text', content: d.answer });

  return (
    <AiBubble label={STEP_LABEL.SYNTHESIZE.label} Icon={STEP_LABEL.SYNTHESIZE.Icon} accent="violet" testId="stream-step-synthesize">
      <div className="space-y-2.5">
        {parts.map((p, i) =>
          p.type === 'text' ? (
            p.content && (
              <p key={i} className="text-foreground/95 leading-relaxed whitespace-pre-wrap">{p.content}</p>
            )
          ) : (
            <pre
              key={i}
              className="bg-slate-950/80 border border-border/60 rounded-xl p-3 text-[11px] font-mono overflow-x-auto text-emerald-200"
              data-testid="code-refactored"
            >
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{p.lang}</div>
              <code>{p.content}</code>
            </pre>
          )
        )}
      </div>

      {d.keyFindings.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">key takeaways</div>
          <ul className="space-y-0.5">
            {d.keyFindings.map((k, i) => (
              <li key={i} className="text-[12px] text-foreground/85 flex gap-2">
                <span className="text-violet-400">·</span>
                <span>{k}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.openQuestions.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">still wondering</div>
          <ul className="space-y-0.5">
            {d.openQuestions.map((q, i) => (
              <li key={i} className="text-[12px] text-foreground/75 flex gap-2">
                <span className="text-muted-foreground/60">?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[10px] mt-2 font-mono text-muted-foreground">
        confidence {(d.finalConfidence * 100).toFixed(0)}%
      </div>
    </AiBubble>
  );
}

function WebSearchBubble({ d }: { d: WebSearchPayload }) {
  return (
    <AiBubble label={STEP_LABEL.WEB_SEARCH.label} Icon={STEP_LABEL.WEB_SEARCH.Icon} accent="cyan" testId="stream-step-web-search">
      <p className="text-foreground/95 leading-relaxed mb-2">
        I just pulled <span className="text-cyan-300 font-medium">{d.totalSources}</span> live sources for "{d.query}".
      </p>
      <ul className="space-y-1.5">
        {d.sources.map((s) => {
          const safe = /^https?:\/\//i.test(s.url);
          return (
            <li key={s.index} className="flex items-start gap-2 text-[12px] border border-border/30 rounded-xl p-2 bg-muted/20">
              <span className="text-cyan-400 font-mono text-[10px] shrink-0 mt-0.5">[{s.index}]</span>
              <div className="min-w-0 flex-1">
                {safe ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300 hover:text-cyan-200 hover:underline text-[12px] font-medium flex items-center gap-1"
                  >
                    <span className="truncate">{s.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                  </a>
                ) : (
                  <span className="text-foreground/85 truncate block">{s.title}</span>
                )}
                {s.snippet && (
                  <div className="text-[11px] text-muted-foreground/85 mt-0.5 line-clamp-2">{s.snippet}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </AiBubble>
  );
}

function PatternBubble({ d }: { d: PatternPayload }) {
  const max = Math.max(1, ...d.patterns.map((p) => p.frequency));
  return (
    <AiBubble label={STEP_LABEL.PATTERN.label} Icon={STEP_LABEL.PATTERN.Icon} accent="fuchsia" testId="stream-step-pattern">
      <div className="space-y-2">
        {d.patterns.map((p, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-[12px] mb-0.5">
              <span className="text-foreground/90">{p.theme}</span>
              <span className="text-fuchsia-300 font-mono text-[10px]">{p.frequency}×</span>
            </div>
            <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-fuchsia-500/70 rounded-full" style={{ width: `${(p.frequency / max) * 100}%` }} />
            </div>
            {p.supportingSources.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {p.supportingSources.map((s) => (
                  <span key={s} className="text-[9px] text-fuchsia-300/80 font-mono">[{s}]</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {d.dominantThemes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/80 font-mono mb-1">dominant themes</div>
          <div className="flex gap-1 flex-wrap">
            {d.dominantThemes.map((t, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30">{t}</span>
            ))}
          </div>
        </div>
      )}
      {d.outliers.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">outliers</div>
          {d.outliers.map((o, i) => (
            <div key={i} className="text-[12px] text-foreground/75 flex gap-2"><span className="text-fuchsia-400/60">·</span>{o}</div>
          ))}
        </div>
      )}
    </AiBubble>
  );
}

function ReflectBubble({ d }: { d: ReflectPayload }) {
  return (
    <AiBubble label={STEP_LABEL.REFLECT.label} Icon={STEP_LABEL.REFLECT.Icon} accent="amber" testId="stream-step-reflect">
      <p className="text-foreground/95 leading-relaxed italic mb-2.5">{d.personalSummary}</p>

      {d.interestingObservations.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-mono mb-1 flex items-center gap-1">
            <Lightbulb className="h-3 w-3" /> what struck me
          </div>
          <ul className="space-y-0.5">
            {d.interestingObservations.map((o, i) => (
              <li key={i} className="text-[12px] text-foreground/85 flex gap-2">
                <span className="text-amber-400/70">◆</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.autonomousExplorations.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-mono mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> if I had free rein, I'd
          </div>
          <ul className="space-y-1">
            {d.autonomousExplorations.map((e, i) => (
              <li key={i} className="text-[12px] text-foreground/85 bg-amber-500/5 border border-amber-500/20 rounded-lg px-2 py-1 flex gap-2">
                <span className="text-amber-400">→</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.selfAssessment && (
        <div className="pt-2 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-0.5">where I might be wrong</div>
          <p className="text-[12px] text-muted-foreground/90 italic leading-relaxed">{d.selfAssessment}</p>
        </div>
      )}
    </AiBubble>
  );
}

// ───────────── Typing indicator ─────────────

function TypingIndicator({ label, tokenPreview }: { label?: string | null; tokenPreview: string }) {
  return (
    <div className="flex flex-col items-start px-1 gap-1" data-testid="typing-indicator">
      {label && (
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono pl-3 italic">
          {label}
        </div>
      )}
      <div className="rounded-3xl rounded-bl-md bg-card/60 border border-border/40 px-4 py-2.5 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      {tokenPreview && (
        <div className="text-[10px] text-muted-foreground/40 font-mono pl-3 max-w-[80%] truncate">
          {tokenPreview.slice(-80)}
        </div>
      )}
    </div>
  );
}
