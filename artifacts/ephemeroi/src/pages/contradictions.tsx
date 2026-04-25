import { useListEphemeroiContradictions } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { AlertTriangle, ShieldCheck, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Contradictions() {
  const { data, isLoading } = useListEphemeroiContradictions();

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 bg-card mb-8" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full bg-card" />)}
      </div>
    );
  }

  const unresolved = data?.contradictions.filter(c => !c.resolved) || [];
  const resolved = data?.contradictions.filter(c => c.resolved) || [];

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <header>
        <h2 className="font-serif text-3xl text-foreground mb-2 flex items-center gap-3">
          Tensions <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">{unresolved.length} Open</Badge>
        </h2>
        <p className="text-muted-foreground">Friction points between new observations and established beliefs.</p>
      </header>

      {data?.contradictions.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
          No tensions detected. The observer's worldview is currently stable.
        </div>
      ) : (
        <div className="space-y-8">
          
          {unresolved.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" /> Active Tensions
              </h3>
              <div className="grid gap-4">
                {unresolved.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card className="bg-amber-500/5 border-amber-500/20 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500/50"></div>
                      <CardContent className="p-6 pl-8">
                        <div className="flex justify-between items-start mb-3">
                          <span className="text-xs text-amber-500/70 font-mono">
                            Detected {formatDistanceToNow(new Date(c.detectedAt))} ago
                          </span>
                        </div>
                        <p className="text-foreground text-lg mb-4">{c.summary}</p>
                        
                        {c.beliefProposition && (
                          <div className="bg-background/50 rounded p-3 text-sm border border-border/50">
                            <span className="text-muted-foreground uppercase text-[10px] tracking-wider block mb-1">Conflicts with belief</span>
                            <span className="font-serif italic">"{c.beliefProposition}"</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-4 pt-8 border-t border-border/30">
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Resolved Tensions
              </h3>
              <div className="grid gap-4 opacity-70">
                {resolved.map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card className="bg-card/20 border-border/40">
                      <CardContent className="p-4 flex gap-4 items-center">
                        <ShieldCheck className="w-5 h-5 text-emerald-500/50 shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm text-muted-foreground line-clamp-2">{c.summary}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
