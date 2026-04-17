import React, { useState } from "react";
import { useGetSampleQueries } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Search, Zap, Brain, Code2, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SearchMode, StartSearchOptions } from "@/hooks/use-search-stream";

interface QueryInterfaceProps {
  onSubmit: (opts: StartSearchOptions) => void;
  isRunning: boolean;
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

const MODE_OPTIONS: Array<{ id: SearchMode; label: string; icon: typeof Brain; hint: string }> = [
  { id: "research", label: "Research", icon: Brain, hint: "LLM-simulated retrieval" },
  { id: "code", label: "Code Review", icon: Code2, hint: "Paste code, get refactor" },
  { id: "web", label: "Web Search", icon: Globe, hint: "Real sources + patterns" },
];

export function QueryInterface({ onSubmit, isRunning }: QueryInterfaceProps) {
  const [mode, setMode] = useState<SearchMode>("research");
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const { data: sampleQueriesData, isLoading } = useGetSampleQueries();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRunning) return;
    if (mode === "code") {
      if (!code.trim()) return;
      onSubmit({ query: query.trim() || "general code quality review", mode, code });
    } else {
      if (!query.trim()) return;
      onSubmit({ query: query.trim(), mode });
    }
  };

  const placeholder =
    mode === "research"
      ? "Enter a complex research question..."
      : mode === "code"
      ? "Optional: focus area (e.g. 'security', 'performance', 'readability')"
      : "Enter a question to research with live web sources...";

  const canSubmit = mode === "code" ? !!code.trim() : !!query.trim();

  return (
    <div className="flex flex-col gap-4">
      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-muted/40 rounded-md border border-border/50">
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              disabled={isRunning}
              className={cn(
                "flex flex-col items-center gap-1 px-2 py-2 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                active
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
              title={opt.hint}
              data-testid={`button-mode-${opt.id}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="relative">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className={cn(
              "bg-card text-card-foreground border-border font-mono text-sm resize-none focus-visible:ring-1 focus-visible:ring-primary pr-12",
              mode === "code" ? "min-h-[60px]" : "min-h-[120px]"
            )}
            data-testid="input-query"
            disabled={isRunning}
          />
          {mode !== "code" && (
            <Button
              type="submit"
              disabled={!canSubmit || isRunning}
              size="icon"
              className="absolute bottom-3 right-3 rounded-full"
              data-testid="button-submit-query"
            >
              {isRunning ? <Zap className="h-4 w-4 animate-pulse text-amber-500" /> : <Search className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {mode === "code" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Source code</label>
              <button
                type="button"
                onClick={() => setCode(SAMPLE_CODE)}
                className="text-[10px] font-mono text-primary hover:underline"
                data-testid="button-load-sample-code"
              >
                load sample
              </button>
            </div>
            <Textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste source code here..."
              className="min-h-[180px] bg-card text-card-foreground border-border font-mono text-xs resize-none focus-visible:ring-1 focus-visible:ring-primary"
              data-testid="input-code"
              disabled={isRunning}
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={!canSubmit || isRunning}
              className="w-full"
              data-testid="button-submit-code"
            >
              {isRunning ? (
                <><Zap className="h-4 w-4 mr-2 animate-pulse text-amber-500" /> Reviewing…</>
              ) : (
                <><Code2 className="h-4 w-4 mr-2" /> Review code</>
              )}
            </Button>
          </div>
        )}
      </form>

      {mode !== "code" && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
            {mode === "web" ? "Sample Queries (will hit real web)" : "Sample Queries"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-md" />
              ))
            ) : (
              sampleQueriesData?.queries?.map((sample) => (
                <Card
                  key={sample.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors border-border/50"
                  onClick={() => setQuery(sample.query)}
                  data-testid={`card-sample-query-${sample.id}`}
                >
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-medium text-primary">{sample.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{sample.domain}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2" title={sample.query}>
                      {sample.query}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
