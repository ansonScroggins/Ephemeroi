import { useGetEphemeroiState } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Radio, AlertTriangle, FileText, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export default function Overview() {
  const { data: state, isLoading } = useGetEphemeroiState();

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full bg-card" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-8 w-48 bg-card" />
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full bg-card" />)}
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-8 w-32 bg-card" />
            <Skeleton className="h-96 w-full bg-card" />
          </div>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const stats = [
    { label: "Active Sources", value: state.sources.filter(s => s.active).length, icon: Radio, color: "text-blue-400" },
    { label: "Beliefs Formed", value: state.beliefs.length, icon: BookOpen, color: "text-emerald-400" },
    { label: "Open Tensions", value: state.contradictions.filter(c => !c.resolved).length, icon: AlertTriangle, color: "text-amber-400" },
    { label: "Reports Generated", value: state.recentReports.length, icon: FileText, color: "text-purple-400" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-2">Live Stream</h2>
          <p className="text-muted-foreground">The observer is {state.loop.running ? <span className="text-primary font-medium animate-pulse">watching</span> : <span className="text-destructive">paused</span>}.</p>
        </div>
        
        {state.loop.running && state.loop.lastCycleAt && (
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <Activity className="w-3 h-3 text-primary animate-pulse" />
            Last cycle {formatDistanceToNow(new Date(state.loop.lastCycleAt))} ago
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
          >
            <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <stat.icon className={`w-5 h-5 ${stat.color} opacity-80`} />
                  <span className="text-3xl font-serif text-foreground">{stat.value}</span>
                </div>
                <div className="text-sm text-muted-foreground font-medium">{stat.label}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-lg font-medium text-foreground border-b border-border pb-2">Recent Observations</h3>
          
          <div className="space-y-4">
            <AnimatePresence>
              {state.recentObservations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg">
                  Ephemeroi hasn't seen anything yet — give it something to watch.
                </div>
              ) : (
                state.recentObservations.slice(0, 10).map((obs, i) => (
                  <motion.div
                    key={obs.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card className="bg-card/30 border-border/50 hover:bg-card/50 transition-colors">
                      <CardContent className="p-5">
                        <div className="flex justify-between items-start mb-2">
                          <Badge variant="outline" className="text-xs bg-background/50 text-muted-foreground">
                            {obs.sourceLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatDistanceToNow(new Date(obs.observedAt))} ago
                          </span>
                        </div>
                        <h4 className="text-base font-medium text-foreground mb-2 leading-tight">
                          {obs.url ? (
                            <a href={obs.url} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
                              {obs.title}
                            </a>
                          ) : (
                            obs.title
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground/80 line-clamp-2 mb-3">
                          {obs.snippet}
                        </p>
                        <div className="flex gap-4 text-xs font-mono">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50"></span>
                            Novelty: {(obs.novelty * 100).toFixed(0)}%
                          </span>
                          {obs.importance > -1 && (
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500/50"></span>
                              Importance: {(obs.importance * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-medium text-foreground border-b border-border pb-2">Recent Reports</h3>
          
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-4">
              {state.recentReports.length === 0 ? (
                <div className="text-sm text-muted-foreground italic text-center py-8">
                  No reports have crossed the threshold yet.
                </div>
              ) : (
                state.recentReports.map((report) => (
                  <Card key={report.id} className="bg-primary/5 border-primary/20">
                    <CardContent className="p-4">
                      <div className="text-xs text-primary/70 mb-2 font-mono">
                        {formatDistanceToNow(new Date(report.createdAt))} ago
                      </div>
                      <h4 className="font-serif text-foreground font-medium mb-2 leading-snug">
                        {report.headline}
                      </h4>
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {report.body}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

    </div>
  );
}
