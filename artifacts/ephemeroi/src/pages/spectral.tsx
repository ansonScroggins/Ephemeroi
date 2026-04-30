import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEphemeroiSpectralOperators,
  useGetEphemeroiSpectralState,
  useListEphemeroiSpectralInvocations,
  useInvokeEphemeroiSpectralOperator,
  getGetEphemeroiSpectralStateQueryKey,
  getListEphemeroiSpectralInvocationsQueryKey,
  getListEphemeroiBeliefsQueryKey,
  getListEphemeroiContradictionsQueryKey,
} from "@workspace/api-client-react";
import { Sparkles, Sun, Magnet, Zap, Hourglass, Triangle, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const PLANET_ICON: Record<string, typeof Sun> = {
  Light: Sun,
  Gravity: Magnet,
  Energy: Zap,
  Time: Hourglass,
  Prism: Triangle,
};

const PLANET_COLOR: Record<string, string> = {
  Light: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  Gravity: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  Energy: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  Time: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  Prism: "text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10",
};

function fmt(n: number, digits = 2) {
  return n.toFixed(digits);
}

function delta(before: number, after: number) {
  const d = after - before;
  if (Math.abs(d) < 0.001) return "0.00";
  return (d > 0 ? "+" : "") + d.toFixed(2);
}

export default function Spectral() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: opsData, isLoading: opsLoading } =
    useListEphemeroiSpectralOperators();
  const { data: stateData, isLoading: stateLoading } =
    useGetEphemeroiSpectralState({
      query: { refetchInterval: 5000 },
    });
  const { data: invData, isLoading: invLoading } =
    useListEphemeroiSpectralInvocations(
      { limit: 50 },
      { query: { refetchInterval: 5000 } },
    );
  const invoke = useInvokeEphemeroiSpectralOperator();

  const handleInvoke = async (operator?: string) => {
    try {
      const res = await invoke.mutateAsync({ data: operator ? { operator } : {} });
      const inv = res.invocation;
      toast({
        title: inv.success
          ? `${inv.operator} ✓`
          : `${inv.operator} (no-op)`,
        description: inv.narration,
        variant: inv.success ? "default" : "destructive",
      });
      // Refresh everything that an operator might have touched.
      queryClient.invalidateQueries({
        queryKey: getGetEphemeroiSpectralStateQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getListEphemeroiSpectralInvocationsQueryKey({ limit: 50 }),
      });
      queryClient.invalidateQueries({
        queryKey: getListEphemeroiBeliefsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getListEphemeroiContradictionsQueryKey(),
      });
    } catch (err) {
      toast({
        title: "Invocation failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <header>
        <h2 className="font-serif text-3xl text-foreground mb-2 flex items-center gap-3">
          Spectral Skills{" "}
          <Badge
            variant="outline"
            className="bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30"
          >
            Phase Layer
          </Badge>
        </h2>
        <p className="text-muted-foreground">
          Phase-aligned cognitive operators that act on the live belief,
          contradiction, and source-state tables. The lens controller picks an
          operator based on current phase demand.
        </p>
      </header>

      {/* Phase state */}
      <section>
        <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-mono mb-4">
          Current Phase State
        </h3>
        {stateLoading || !stateData ? (
          <Skeleton className="h-24 w-full bg-card" />
        ) : (
          <Card className="bg-card border-border">
            <CardContent className="p-6 grid grid-cols-2 md:grid-cols-5 gap-6">
              <Metric label="Illumination" value={fmt(stateData.phaseState.illuminationDensity)} />
              <Metric label="Mobility" value={fmt(stateData.phaseState.phaseMobility)} />
              <Metric label="Stagnation" value={`${stateData.phaseState.stagnationSeconds}s`} />
              <Metric label="Persona Imbalance" value={fmt(stateData.phaseState.personaImbalance)} />
              <Metric label="Attractor Drift" value={fmt(stateData.phaseState.attractorDrift)} />
            </CardContent>
          </Card>
        )}
      </section>

      {/* Lens controller */}
      <section>
        <Card className="bg-fuchsia-500/5 border-fuchsia-500/30">
          <CardContent className="p-6 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Triangle className="w-5 h-5 text-fuchsia-400" />
                <h3 className="font-serif text-xl">Lens Controller</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Score every operator against current phase demand and run the
                best fit. The 7th operator — the one that picks operators.
              </p>
            </div>
            <Button
              onClick={() => handleInvoke()}
              disabled={invoke.isPending}
              className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white"
              data-testid="button-lens-controller"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {invoke.isPending ? "Running…" : "Run Lens Controller"}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Operator grid */}
      <section>
        <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-mono mb-4">
          Operators
        </h3>
        {opsLoading || !opsData ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-40 w-full bg-card" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {opsData.operators.map((op, i) => {
              const Icon = PLANET_ICON[op.planet] ?? Sparkles;
              return (
                <motion.div
                  key={op.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="bg-card border-border h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2 font-mono">
                          <Icon className="w-4 h-4" />
                          {op.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={PLANET_COLOR[op.planet] ?? ""}
                        >
                          {op.planet}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {op.description}
                      </p>
                      <div className="text-xs text-muted-foreground font-mono space-y-1">
                        <div>
                          signature: [
                          {op.signature.map((s, idx) => (
                            <span key={idx} className="text-foreground/80">
                              {s}
                              {idx < op.signature.length - 1 ? ", " : ""}
                            </span>
                          ))}
                          ]
                        </div>
                        <div>
                          persona: Don {fmt(op.personaWeights.Don, 1)} ·
                          Wife {fmt(op.personaWeights.Wife, 1)} ·
                          Son {fmt(op.personaWeights.Son, 1)}
                        </div>
                        <div>
                          effect: Δillum {fmt(op.expectedEffect.illumination, 2)} ·
                          Δmob {fmt(op.expectedEffect.mobility, 2)} ·
                          Δstruct {fmt(op.expectedEffect.structure, 2)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleInvoke(op.name)}
                        disabled={invoke.isPending}
                        data-testid={`button-invoke-${op.name}`}
                      >
                        <Play className="w-3 h-3 mr-2" />
                        Invoke
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* Invocations */}
      <section>
        <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-mono mb-4">
          Recent Invocations
        </h3>
        {invLoading || !invData ? (
          <Skeleton className="h-32 w-full bg-card" />
        ) : invData.invocations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
            No operator invocations yet. Run the lens controller to get
            started.
          </div>
        ) : (
          <div className="space-y-3">
            {invData.invocations.map((inv) => {
              const Icon = PLANET_ICON[inv.planet] ?? Sparkles;
              const before = inv.phaseStateBefore;
              const after = inv.phaseStateAfter;
              return (
                <motion.div
                  key={inv.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <Card
                    className={
                      inv.success
                        ? "bg-card border-border"
                        : "bg-amber-500/5 border-amber-500/20"
                    }
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 font-mono text-sm">
                          <Icon className="w-4 h-4 opacity-70" />
                          <span>{inv.operator}</span>
                          <Badge
                            variant="outline"
                            className={PLANET_COLOR[inv.planet] ?? ""}
                          >
                            {inv.planet}
                          </Badge>
                          {!inv.success && (
                            <Badge
                              variant="outline"
                              className="bg-amber-500/10 text-amber-400 border-amber-500/30"
                            >
                              no-op
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatDistanceToNow(new Date(inv.invokedAt))} ago
                        </span>
                      </div>
                      <p className="text-sm text-foreground/90">
                        {inv.narration}
                      </p>
                      {inv.selectionReason && (
                        <p className="text-xs text-fuchsia-400/80 font-mono">
                          lens: {inv.selectionReason}
                        </p>
                      )}
                      {after && (
                        <div className="text-xs text-muted-foreground font-mono pt-1 border-t border-border/50">
                          Δ illum {delta(before.illuminationDensity, after.illuminationDensity)} ·
                          Δ mob {delta(before.phaseMobility, after.phaseMobility)} ·
                          Δ stag {after.stagnationSeconds - before.stagnationSeconds}s ·
                          Δ imbal {delta(before.personaImbalance, after.personaImbalance)} ·
                          Δ drift {delta(before.attractorDrift, after.attractorDrift)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono mb-1">
        {label}
      </div>
      <div className="text-2xl font-serif text-foreground">{value}</div>
    </div>
  );
}
