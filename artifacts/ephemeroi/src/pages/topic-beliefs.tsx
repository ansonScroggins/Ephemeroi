import {
  useListEphemeroiTopicBeliefs,
  useGetEphemeroiCognitiveField,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  FileText,
  MessageSquare,
  Repeat,
  Waves,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const MOOD_STYLES: Record<string, string> = {
  settled: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  contested: "text-rose-400 border-rose-400/30 bg-rose-400/10",
  oscillating: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  neutral: "text-muted-foreground border-border/50 bg-muted/20",
};

export default function TopicBeliefs() {
  const { data, isLoading } = useListEphemeroiTopicBeliefs(
    { limit: 100 },
    { query: { refetchInterval: 15000 } },
  );
  const { data: field } = useGetEphemeroiCognitiveField({
    query: { refetchInterval: 15000 },
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64 bg-card mb-8" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full bg-card" />
          ))}
        </div>
      </div>
    );
  }

  const beliefs = data?.beliefs ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header>
        <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <h2 className="font-serif text-3xl text-foreground">
            Topic Beliefs
          </h2>
          {field && (
            <Badge
              variant="outline"
              className={`${MOOD_STYLES[field.mood] ?? MOOD_STYLES.neutral} flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider`}
              title={
                field.snapshot
                  ? `consensus ${(field.snapshot.consensusMean * 100).toFixed(0)}%, turbulence ${(field.snapshot.turbulence * 100).toFixed(0)}%, conflict ${(field.snapshot.conflict * 100).toFixed(0)}%, decay ×${field.decayMultiplier.toFixed(2)}`
                  : "no biomimetic run yet"
              }
            >
              <Waves className="w-3 h-3" />
              field: {field.mood}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Stances I have formed autonomously from Telegram conversations and
          uploaded PDFs. Each one moves on its own as new exchanges arrive —
          nothing here was written by hand.
        </p>
      </header>

      {beliefs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
          No topic beliefs yet. Send me a question on Telegram about a specific
          subject and I will start forming an opinion.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {beliefs.map((b, i) => {
            // Trajectory: compare current confidence to the previous history
            // entry (if any) so the badge can hint "warming / cooling /
            // steady". history[0] is the just-written entry, so use [1].
            const prev = b.history[1];
            const delta = prev ? b.confidence - prev.confidence : 0;
            const trend =
              delta > 0.05 ? "up" : delta < -0.05 ? "down" : "steady";
            const isStrong = b.confidence > 0.65;

            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.04, 0.6) }}
              >
                <Card className="h-full bg-card/40 border-border/50 hover:bg-card/60 transition-colors">
                  <CardContent className="p-6 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-3 gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Subject
                        </span>
                        <span className="font-mono text-sm text-foreground truncate">
                          {b.subject}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {b.flipCount > 0 && (
                          <Badge
                            variant="outline"
                            className="text-violet-300 border-violet-400/30 bg-violet-400/10 flex items-center gap-1"
                            title={`Stance has flipped ${b.flipCount}× over time`}
                          >
                            <Repeat className="w-3 h-3" />
                            {b.flipCount}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            isStrong
                              ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
                              : "text-amber-400 border-amber-400/30 bg-amber-400/10"
                          }
                        >
                          {isStrong ? "Strong" : "Forming"}
                        </Badge>
                      </div>
                    </div>

                    <p className="font-serif text-foreground mb-4 flex-1">
                      "{b.stance}"
                    </p>

                    {b.lastEvidence && (
                      <p className="text-xs text-muted-foreground italic mb-4 line-clamp-2">
                        Evidence: {b.lastEvidence}
                      </p>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/50 mt-auto text-xs">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                          Confidence
                        </span>
                        <span className="font-mono text-foreground flex items-center gap-1">
                          {(b.confidence * 100).toFixed(0)}%
                          {trend === "up" && (
                            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                          )}
                          {trend === "down" && (
                            <ArrowDownRight className="w-3 h-3 text-rose-400" />
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                          Evidence
                        </span>
                        <span className="font-mono text-foreground flex items-center gap-1">
                          <Brain className="w-3 h-3" /> {b.evidenceCount}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                          Last via
                        </span>
                        <span className="font-mono text-foreground flex items-center gap-1">
                          {b.lastSourceKind === "pdf" ? (
                            <>
                              <FileText className="w-3 h-3" /> pdf
                            </>
                          ) : (
                            <>
                              <MessageSquare className="w-3 h-3" /> qa
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 text-[10px] font-mono text-muted-foreground flex justify-between">
                      <span>
                        Updated{" "}
                        {formatDistanceToNow(new Date(b.lastUpdatedAt))} ago
                      </span>
                      {b.history.length > 1 && (
                        <span>{b.history.length} revisions</span>
                      )}
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
