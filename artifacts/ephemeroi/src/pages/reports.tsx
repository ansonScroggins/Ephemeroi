import { useListEphemeroiReports } from "@workspace/api-client-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { FileText, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Reports() {
  const { data, isLoading } = useListEphemeroiReports({ limit: 50 });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 bg-card mb-8" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full bg-card" />)}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <header>
        <h2 className="font-serif text-3xl text-foreground mb-2">Reports</h2>
        <p className="text-muted-foreground">Significant moments that crossed the importance threshold.</p>
      </header>

      {data?.reports.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
          No reports generated yet. The observer is still waiting for something important.
        </div>
      ) : (
        <div className="relative border-l border-border/50 ml-4 md:ml-8 pl-6 md:pl-10 space-y-12 py-4">
          {data?.reports.map((report, i) => (
            <motion.div
              key={report.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              {/* Timeline dot */}
              <div className="absolute -left-[30px] md:-left-[46px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-background bg-primary shadow-[0_0_10px_rgba(251,191,36,0.5)]"></div>
              
              <Card className="bg-card/40 border-border/50 hover:bg-card/60 transition-colors group">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div className="text-sm font-mono text-primary/80">
                      {format(new Date(report.createdAt), "MMM d, yyyy • HH:mm")}
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="bg-background/50 font-mono text-xs">
                        IMP: {(report.importance * 100).toFixed(0)}%
                      </Badge>
                      {report.delivered && (
                        <Badge variant="secondary" className="bg-primary/10 text-primary flex gap-1 text-xs">
                          <Send className="w-3 h-3" /> Delivered
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <h3 className="text-xl md:text-2xl font-serif text-foreground mb-4 leading-tight group-hover:text-primary transition-colors">
                    {report.headline}
                  </h3>
                  
                  <div className="prose prose-invert prose-sm max-w-none text-muted-foreground">
                    <p className="whitespace-pre-wrap">{report.body}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
