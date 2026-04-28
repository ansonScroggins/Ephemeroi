import { useListEphemeroiBeliefs } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Shield, ShieldAlert, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Beliefs() {
  const { data, isLoading } = useListEphemeroiBeliefs();

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 bg-card mb-8" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 w-full bg-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header>
        <h2 className="font-serif text-3xl text-foreground mb-2">Memory & Beliefs</h2>
        <p className="text-muted-foreground">The synthesis of observed patterns over time.</p>
      </header>

      {data?.beliefs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
          The observer has not formed any concrete beliefs yet.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {data?.beliefs
            .sort((a, b) => b.confidence - a.confidence)
            .map((belief, i) => {
              const isStrong = belief.confidence > 0.6;
              const isWeak = belief.confidence < -0.2;
              
              return (
                <motion.div
                  key={belief.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="h-full bg-card/40 border-border/50 hover:bg-card/60 transition-colors">
                    <CardContent className="p-6 flex flex-col h-full">
                      <div className="flex justify-between items-start mb-4">
                        <Badge 
                          variant="outline" 
                          className={`
                            ${isStrong ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' : ''}
                            ${isWeak ? 'text-rose-400 border-rose-400/30 bg-rose-400/10' : ''}
                            ${!isStrong && !isWeak ? 'text-amber-400 border-amber-400/30 bg-amber-400/10' : ''}
                          `}
                        >
                          {isStrong ? 'Strong Belief' : isWeak ? 'Disputed' : 'Forming'}
                        </Badge>
                        <div className="text-xs font-mono text-muted-foreground flex flex-col items-end">
                          <span>Updated {formatDistanceToNow(new Date(belief.lastUpdatedAt))} ago</span>
                        </div>
                      </div>

                      <p className="text-lg font-serif text-foreground mb-6 flex-1">
                        "{belief.proposition}"
                      </p>

                      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/50 mt-auto">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Confidence</span>
                          <span className="text-sm font-mono text-foreground">
                            {(belief.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Support</span>
                          <span className="text-sm font-mono text-emerald-400 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" /> {belief.supportCount}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Contradict</span>
                          <span className="text-sm font-mono text-rose-400 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {belief.contradictCount}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
          })}
        </div>
      )}
    </div>
  );
}
