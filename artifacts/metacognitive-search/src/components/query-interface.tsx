import React, { useState } from "react";
import { useGetSampleQueries } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Search, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

interface QueryInterfaceProps {
  onSubmit: (query: string) => void;
  isRunning: boolean;
}

export function QueryInterface({ onSubmit, isRunning }: QueryInterfaceProps) {
  const [query, setQuery] = useState("");
  const { data: sampleQueriesData, isLoading } = useGetSampleQueries();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isRunning) {
      onSubmit(query.trim());
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="relative">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a complex research question..."
            className="min-h-[120px] bg-card text-card-foreground border-border font-mono text-sm resize-none focus-visible:ring-1 focus-visible:ring-primary pr-12"
            data-testid="input-query"
            disabled={isRunning}
          />
          <Button
            type="submit"
            disabled={!query.trim() || isRunning}
            size="icon"
            className="absolute bottom-3 right-3 rounded-full"
            data-testid="button-submit-query"
          >
            {isRunning ? <Zap className="h-4 w-4 animate-pulse text-amber-500" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">Sample Queries</h3>
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
    </div>
  );
}