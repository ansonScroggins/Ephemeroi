import { useState } from "react";
import {
  useListEphemeroiBeliefs,
  useDeleteEphemeroiBelief,
  useTrimEphemeroiBelief,
  getListEphemeroiBeliefsQueryKey,
  type EphemeroiBelief,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, AlertTriangle, Trash2, Scissors } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const TRIM_PRESETS: Array<{ label: string; keep: number; hint: string }> = [
  { label: "Keep half",     keep: 0.5,  hint: "Halves confidence and counts." },
  { label: "Keep a quarter", keep: 0.25, hint: "Most signal goes; a small piece remains." },
  { label: "Keep a tenth",  keep: 0.1,  hint: "Almost a reset, but the proposition stays alive." },
  { label: "Soft reset",    keep: 0,    hint: "Wipe confidence and counts; proposition can re-form organically." },
];

export default function Beliefs() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListEphemeroiBeliefs();
  const deleteBelief = useDeleteEphemeroiBelief();
  const trimBelief = useTrimEphemeroiBelief();
  const { toast } = useToast();

  const [confirmClear, setConfirmClear] = useState<EphemeroiBelief | null>(null);
  const [trimTarget, setTrimTarget] = useState<EphemeroiBelief | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListEphemeroiBeliefsQueryKey() });

  const handleClear = async () => {
    if (!confirmClear) return;
    try {
      await deleteBelief.mutateAsync({ id: confirmClear.id });
      toast({ title: "Belief cleared", description: `"${truncate(confirmClear.proposition, 80)}"` });
      await invalidate();
    } catch (err) {
      toast({
        title: "Couldn't clear belief",
        description: errMsg(err),
        variant: "destructive",
      });
    } finally {
      setConfirmClear(null);
    }
  };

  const handleTrim = async (keep: number) => {
    if (!trimTarget) return;
    try {
      await trimBelief.mutateAsync({
        id: trimTarget.id,
        data: { keepFraction: keep },
      });
      toast({
        title: keep === 0 ? "Belief soft-reset" : `Belief trimmed to ${Math.round(keep * 100)}%`,
        description: `"${truncate(trimTarget.proposition, 80)}"`,
      });
      await invalidate();
    } catch (err) {
      toast({
        title: "Couldn't trim belief",
        description: errMsg(err),
        variant: "destructive",
      });
    } finally {
      setTrimTarget(null);
    }
  };

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
        <p className="text-muted-foreground">
          The synthesis of observed patterns over time. Clear what no longer serves —
          or trim a belief down to a small piece so it can re-form on fresh evidence.
        </p>
      </header>

      {data?.beliefs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground italic border border-dashed border-border rounded-lg bg-card/20">
          The observer has not formed any concrete beliefs yet.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <AnimatePresence>
            {data?.beliefs
              .sort((a, b) => b.confidence - a.confidence)
              .map((belief, i) => {
                const isStrong = belief.confidence > 0.6;
                const isWeak = belief.confidence < -0.2;

                return (
                  <motion.div
                    key={belief.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Card className="h-full bg-card/40 border-border/50 hover:bg-card/60 transition-colors">
                      <CardContent className="p-6 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-4 gap-3">
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

                        <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-border/30">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setTrimTarget(belief)}
                            disabled={trimBelief.isPending || deleteBelief.isPending}
                            data-testid={`button-trim-belief-${belief.id}`}
                          >
                            <Scissors className="w-3 h-3 mr-1" />
                            Trim
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-rose-400"
                            onClick={() => setConfirmClear(belief)}
                            disabled={trimBelief.isPending || deleteBelief.isPending}
                            data-testid={`button-clear-belief-${belief.id}`}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Clear
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>
      )}

      {/* Clear (hard delete) confirmation */}
      <AlertDialog open={confirmClear !== null} onOpenChange={(open) => !open && setConfirmClear(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this belief?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="font-serif italic text-foreground">
                  "{confirmClear?.proposition}"
                </p>
                <p className="text-sm text-muted-foreground">
                  This wipes the belief entirely. The proposition can re-form later if new
                  observations support it. If you want to <em>keep a small piece</em> instead,
                  cancel and use <strong>Trim</strong>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBelief.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              disabled={deleteBelief.isPending}
              className="bg-rose-500/90 hover:bg-rose-500 text-white"
              data-testid="button-confirm-clear-belief"
            >
              {deleteBelief.isPending ? "Clearing…" : "Clear belief"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Trim (scale down) chooser */}
      <Dialog open={trimTarget !== null} onOpenChange={(open) => !open && setTrimTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trim this belief</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <p className="font-serif italic text-foreground">
                  "{trimTarget?.proposition}"
                </p>
                <p className="text-sm text-muted-foreground">
                  Scale this belief's accumulated weight down. The proposition stays —
                  only the confidence and support / contradict counts shrink.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 pt-2">
            {TRIM_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                className="justify-start h-auto py-3 px-4 text-left"
                disabled={trimBelief.isPending}
                onClick={() => handleTrim(preset.keep)}
                data-testid={`button-trim-preset-${Math.round(preset.keep * 100)}`}
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className="font-medium text-foreground">{preset.label}</span>
                  <span className="text-xs text-muted-foreground font-normal">{preset.hint}</span>
                </div>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTrimTarget(null)}
              disabled={trimBelief.isPending}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
