import React, { useState, useRef, useEffect } from "react";
import { useGetSampleQueries } from "@workspace/api-client-react";
import { Brain, Code2, Globe, ArrowUp, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchMode, StartSearchOptions } from "@/hooks/use-search-stream";

interface ChatComposerProps {
  onSubmit: (opts: StartSearchOptions) => void;
  isRunning: boolean;
  onQueryChange?: (q: string, mode: SearchMode) => void;
  onModeChange?: (mode: SearchMode) => void;
  prefill?: { query: string; nonce: number } | null;
}

const SAMPLE_CODE = `function findDuplicates(arr) {
  var dupes = [];
  for (var i = 0; i < arr.length; i++) {
    for (var j = 0; j < arr.length; j++) {
      if (i != j && arr[i] == arr[j]) {
        if (dupes.indexOf(arr[i]) == -1) {
          dupes.push(arr[i]);
        }
      }
    }
  }
  return dupes;
}`;

const MODE_OPTIONS: Array<{ id: SearchMode; label: string; icon: typeof Brain }> = [
  { id: "research", label: "Think", icon: Brain },
  { id: "code", label: "Code", icon: Code2 },
  { id: "web", label: "Web", icon: Globe },
];

export function ChatComposer({ onSubmit, isRunning, onQueryChange, onModeChange, prefill }: ChatComposerProps) {
  const [mode, setMode] = useState<SearchMode>("research");
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [showSamples, setShowSamples] = useState(false);
  const [showCodeSheet, setShowCodeSheet] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: sampleQueriesData } = useGetSampleQueries();

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [query]);

  // Open code sheet when switching into code mode
  useEffect(() => {
    if (mode !== "code") setShowCodeSheet(false);
  }, [mode]);

  // Notify parent of query/mode changes for memory lookup
  useEffect(() => {
    onQueryChange?.(query, mode);
  }, [query, mode, onQueryChange]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  // Accept external prefill (from "use that exact question" in memory pill)
  useEffect(() => {
    if (prefill && prefill.query) {
      setQuery(prefill.query);
      textareaRef.current?.focus();
    }
  }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (isRunning) return;
    if (mode === "code") {
      if (!code.trim()) return;
      onSubmit({ query: query.trim() || "general code quality review", mode, code });
      setQuery("");
      setShowCodeSheet(false);
    } else {
      if (!query.trim()) return;
      onSubmit({ query: query.trim(), mode });
      setQuery("");
    }
    setShowSamples(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = mode === "code" ? !!code.trim() : !!query.trim();

  const placeholder =
    mode === "research"
      ? "Ask me anything…"
      : mode === "code"
      ? "Optional: tell me what to focus on…"
      : "Ask the live web…";

  return (
    <div className="flex flex-col" data-testid="composer-root">
      {/* Sample suggestions sheet */}
      {showSamples && mode !== "code" && (
        <div
          className="border-b border-border/40 bg-card/40 px-3 py-2 max-h-[40dvh] overflow-y-auto animate-in slide-in-from-bottom-2 duration-200"
          data-testid="sheet-samples"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              Try one of these
            </span>
            <button
              type="button"
              onClick={() => setShowSamples(false)}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-close-samples"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {sampleQueriesData?.queries?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setQuery(s.query);
                  setShowSamples(false);
                  textareaRef.current?.focus();
                }}
                className="text-left text-xs bg-muted/40 hover:bg-muted/70 transition-colors rounded-2xl px-3 py-2 border border-border/30"
                data-testid={`card-sample-query-${s.id}`}
              >
                <span className="text-primary font-medium">{s.label}</span>
                <span className="text-muted-foreground ml-2">·</span>
                <span className="text-foreground/80 ml-2">{s.query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Code paste sheet */}
      {showCodeSheet && mode === "code" && (
        <div
          className="border-b border-border/40 bg-card/40 px-3 py-3 animate-in slide-in-from-bottom-2 duration-200"
          data-testid="sheet-code"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              Paste code
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCode(SAMPLE_CODE)}
                className="text-[10px] text-primary hover:underline font-mono"
                data-testid="button-load-sample-code"
              >
                load sample
              </button>
              <button
                type="button"
                onClick={() => setShowCodeSheet(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste source code here…"
            className="w-full min-h-[140px] max-h-[40dvh] bg-background border border-border/40 rounded-xl p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
            spellCheck={false}
            data-testid="input-code"
          />
        </div>
      )}

      {/* Mode pills */}
      <div className="flex items-center justify-center gap-1.5 px-3 pt-2.5">
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setMode(opt.id);
                if (opt.id === "code") setShowCodeSheet(true);
              }}
              disabled={isRunning}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
              data-testid={`button-mode-${opt.id}`}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Input row */}
      <div className="px-3 py-2.5 flex items-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (mode === "code") setShowCodeSheet((v) => !v);
            else setShowSamples((v) => !v);
          }}
          disabled={isRunning}
          className={cn(
            "shrink-0 w-9 h-9 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors",
            isRunning && "opacity-40 cursor-not-allowed"
          )}
          title={mode === "code" ? "Paste code" : "See sample questions"}
          data-testid="button-extras"
        >
          {mode === "code" ? <Plus className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-primary" />}
        </button>

        <div className="flex-1 bg-muted/40 rounded-3xl border border-border/40 flex items-end pr-1.5 focus-within:ring-1 focus-within:ring-primary/40 transition">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isRunning}
            className="flex-1 bg-transparent border-0 outline-none resize-none px-4 py-2.5 text-sm placeholder:text-muted-foreground/70 disabled:opacity-50"
            data-testid={mode === "code" ? "input-query" : "input-query"}
          />
          <button
            type="button"
            onClick={mode === "code" ? submit : submit}
            disabled={!canSend || isRunning}
            className={cn(
              "shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all mb-1",
              canSend && !isRunning
                ? "bg-primary text-primary-foreground shadow shadow-primary/30 hover:scale-105"
                : "bg-muted text-muted-foreground/50"
            )}
            data-testid={mode === "code" ? "button-submit-code" : "button-submit-query"}
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
