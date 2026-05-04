import { useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Atom, Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  useListEphemeroiHiggsRuns,
  useGetEphemeroiHiggsRun,
  useAnalyzeEphemeroiHiggs,
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Outcome = "solved" | "stuck_soft" | "stuck_hard";

const OUTCOME_COLOR: Record<Outcome, string> = {
  solved: "hsl(142 71% 45%)",
  stuck_soft: "hsl(48 96% 53%)",
  stuck_hard: "hsl(0 84% 60%)",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  solved: "Solved",
  stuck_soft: "Stuck (soft)",
  stuck_hard: "Stuck (hard)",
};

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const Icon =
    outcome === "solved"
      ? CheckCircle2
      : outcome === "stuck_soft"
      ? Activity
      : AlertTriangle;
  return (
    <Badge
      variant="outline"
      className="gap-1.5"
      style={{ borderColor: OUTCOME_COLOR[outcome], color: OUTCOME_COLOR[outcome] }}
    >
      <Icon className="h-3 w-3" />
      {OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

function RunDetailChart({ runId }: { runId: number }) {
  const { data, isLoading } = useGetEphemeroiHiggsRun(runId);
  if (isLoading) return <Skeleton className="h-72 w-full bg-card" />;
  if (!data || data.snapshots.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
        No snapshots in this run.
      </div>
    );
  }

  const points = data.snapshots.map((s) => ({
    step: s.step,
    orderParameter: s.orderParameter,
    fieldStrength: s.fieldStrength,
    fieldVariance: s.fieldVariance,
    unsat: s.unsat,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-card/40 border border-border/40 rounded p-2">
          <div className="text-muted-foreground">Outcome</div>
          <div className="mt-1"><OutcomeBadge outcome={data.outcome as Outcome} /></div>
        </div>
        <div className="bg-card/40 border border-border/40 rounded p-2">
          <div className="text-muted-foreground">Final unsat</div>
          <div className="font-mono text-base">{data.finalUnsat}</div>
        </div>
        <div className="bg-card/40 border border-border/40 rounded p-2">
          <div className="text-muted-foreground">Steps</div>
          <div className="font-mono text-base">{data.totalSteps}</div>
        </div>
        <div className="bg-card/40 border border-border/40 rounded p-2">
          <div className="text-muted-foreground">N / clauses</div>
          <div className="font-mono text-base">{data.nVars} / {data.nClauses}</div>
        </div>
      </div>

      <div>
        <h4 className="font-serif text-sm text-foreground mb-2">
          Order parameter — symmetry-breaking signal
        </h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" />
            <XAxis dataKey="step" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                fontSize: "12px",
              }}
            />
            <ReferenceLine y={2.0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "transition threshold", position: "right", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Line
              type="monotone"
              dataKey="orderParameter"
              stroke={OUTCOME_COLOR[data.outcome as Outcome]}
              strokeWidth={2}
              dot={false}
              name="order parameter"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h4 className="font-serif text-sm text-foreground mb-2">
          Field strength + unsat
        </h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" />
            <XAxis dataKey="step" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Line yAxisId="left" type="monotone" dataKey="fieldStrength" stroke="hsl(210 90% 60%)" strokeWidth={2} dot={false} name="field strength" />
            <Line yAxisId="right" type="monotone" dataKey="unsat" stroke="hsl(280 70% 65%)" strokeWidth={2} dot={false} name="unsat" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CrossRunReport() {
  const mutation = useAnalyzeEphemeroiHiggs();
  const data = mutation.data;

  const profilePoints = (() => {
    if (!data) return [];
    const stepSet = new Set<number>();
    for (const o of ["solved", "stuck_soft", "stuck_hard"] as const) {
      for (const p of data.profiles[o]) stepSet.add(p.step);
    }
    const steps = Array.from(stepSet).sort((a, b) => a - b);
    return steps.map((step) => {
      const find = (o: Outcome) =>
        data.profiles[o].find((p) => p.step === step)?.meanOrderParameter ?? null;
      return {
        step,
        solved: find("solved"),
        stuck_soft: find("stuck_soft"),
        stuck_hard: find("stuck_hard"),
      };
    });
  })();

  return (
    <Card className="bg-card/60 border-border/60">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="font-serif text-xl">Cross-run analysis</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Average order-parameter trajectory per outcome bucket. The early-warning step is the first point at which solved and stuck_hard runs visibly diverge.
          </p>
        </div>
        <Button
          onClick={() => mutation.mutate({ data: { limit: 200 } })}
          disabled={mutation.isPending}
          size="sm"
        >
          {mutation.isPending ? (
            <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Analyzing…</>
          ) : (
            "Run analysis"
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {!data && !mutation.isPending && (
          <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
            Click "Run analysis" to aggregate the most recent runs.
          </div>
        )}
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-card/40 border border-border/40 rounded p-2">
                <div className="text-muted-foreground">Total runs</div>
                <div className="font-mono text-base">{data.totalRuns}</div>
              </div>
              <div className="bg-card/40 border border-border/40 rounded p-2">
                <div className="text-muted-foreground">Solved / stuck_soft / stuck_hard</div>
                <div className="font-mono text-base">
                  {data.byOutcome.solved} / {data.byOutcome.stuck_soft} / {data.byOutcome.stuck_hard}
                </div>
              </div>
              <div className="bg-card/40 border border-border/40 rounded p-2">
                <div className="text-muted-foreground">Early-warning step</div>
                <div className="font-mono text-base">
                  {data.earlyWarningStep ?? "—"}
                </div>
              </div>
              <div className="bg-card/40 border border-border/40 rounded p-2">
                <div className="text-muted-foreground">Max divergence</div>
                <div className="font-mono text-base">
                  {data.maxDivergence
                    ? `${data.maxDivergence.gap.toFixed(2)} @ step ${data.maxDivergence.step}`
                    : "—"}
                </div>
              </div>
            </div>

            {profilePoints.length > 0 ? (
              <div>
                <h4 className="font-serif text-sm text-foreground mb-2">
                  Mean order parameter by outcome
                </h4>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={profilePoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" />
                    <XAxis dataKey="step" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <ReferenceLine y={data.opThreshold} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    {data.earlyWarningStep && (
                      <ReferenceLine x={data.earlyWarningStep} stroke="hsl(48 96% 53%)" strokeDasharray="2 4" label={{ value: "early warning", position: "top", fontSize: 10, fill: "hsl(48 96% 53%)" }} />
                    )}
                    <Line type="monotone" dataKey="solved" stroke={OUTCOME_COLOR.solved} strokeWidth={2} dot={false} connectNulls name="solved" />
                    <Line type="monotone" dataKey="stuck_soft" stroke={OUTCOME_COLOR.stuck_soft} strokeWidth={2} dot={false} connectNulls name="stuck_soft" />
                    <Line type="monotone" dataKey="stuck_hard" stroke={OUTCOME_COLOR.stuck_hard} strokeWidth={2} dot={false} connectNulls name="stuck_hard" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground italic">
                Not enough data yet — run a few biomimetic cycles to populate.
              </div>
            )}

            <div>
              <h4 className="font-serif text-sm text-foreground mb-2">
                Transition crossings (OP &gt; {data.opThreshold})
              </h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                {data.transitionDetection.map((t) => (
                  <div key={t.outcome} className="bg-card/40 border border-border/40 rounded p-2">
                    <div className="mb-1">
                      <OutcomeBadge outcome={t.outcome as Outcome} />
                    </div>
                    <div className="text-muted-foreground">Mean crossing step</div>
                    <div className="font-mono text-base">
                      {t.meanCrossingStep ?? "—"}
                    </div>
                    <div className="text-muted-foreground mt-1 text-[10px]">
                      {t.count} run{t.count === 1 ? "" : "s"} crossed
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function HiggsPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading } = useListEphemeroiHiggsRuns({
    limit: 50,
    ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
  });

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <header>
        <h2 className="font-serif text-3xl text-foreground mb-2 flex items-center gap-3">
          <Atom className="h-7 w-7 text-primary" />
          Higgs Phase Transition
        </h2>
        <p className="text-muted-foreground max-w-2xl">
          Each biomimetic run records a per-step trajectory of the
          symmetry-breaking field — the order parameter, the field strength,
          the variance. Solved runs structure then collapse; stuck runs
          plateau. The cross-run analyzer surfaces the earliest step at which
          those two profiles diverge.
        </p>
      </header>

      <CrossRunReport />

      <Card className="bg-card/60 border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-serif text-xl">Recent runs</CardTitle>
            <div className="flex gap-1.5 text-xs">
              <Button
                size="sm"
                variant={outcomeFilter === undefined ? "default" : "outline"}
                onClick={() => setOutcomeFilter(undefined)}
              >
                All
              </Button>
              {(["solved", "stuck_soft", "stuck_hard"] as const).map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={outcomeFilter === o ? "default" : "outline"}
                  onClick={() => setOutcomeFilter(o)}
                >
                  {OUTCOME_LABEL[o]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full bg-card" />
              ))}
            </div>
          ) : data?.runs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
              No runs yet. Trigger a biomimetic run from the overview page to populate this view.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {data?.runs.map((run, i) => (
                <motion.button
                  key={run.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.02 }}
                  onClick={() => setSelectedId(selectedId === run.id ? null : run.id)}
                  className="w-full text-left py-3 px-2 hover:bg-card/40 transition-colors flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <OutcomeBadge outcome={run.outcome as Outcome} />
                    <div className="font-mono text-xs text-muted-foreground">
                      #{run.id}
                    </div>
                    <div className="text-sm">
                      n={run.nVars}, m={run.nClauses}, {run.totalSteps} steps
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span>unsat={run.finalUnsat}</span>
                    <span>{run.snapshotCount} snaps</span>
                    <span>{format(new Date(run.createdAt), "HH:mm:ss")}</span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {selectedId !== null && (
            <div className="mt-6 pt-6 border-t border-border/40">
              <RunDetailChart runId={selectedId} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
