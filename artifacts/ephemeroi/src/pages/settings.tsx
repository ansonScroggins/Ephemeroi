import { useState, useEffect } from "react";
import { 
  useGetEphemeroiSettings, 
  useUpdateEphemeroiSettings,
  useRunEphemeroiCycle,
  useRunEphemeroiSelfImprovement,
  useRunEphemeroiBiomimetic,
  getGetEphemeroiSettingsQueryKey
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Save, Play, Settings2, Bell, Brain, Clock, Zap, Sparkles, Wrench, Dna } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useGetEphemeroiSettings();
  const updateSettings = useUpdateEphemeroiSettings();
  const runCycle = useRunEphemeroiCycle();
  const selfImprove = useRunEphemeroiSelfImprovement();
  const biomimetic = useRunEphemeroiBiomimetic();

  // Local state for optimistic UI before save
  const [local, setLocal] = useState({
    intervalSeconds: 300,
    importanceThreshold: 0.7,
    paused: false,
    telegramEnabled: false,
    noveltyWeight: 0.5,
    noveltyDecay: 0.1,
    autonomyEnabled: false,
    autonomyMaxSources: 50,
  });

  useEffect(() => {
    if (settings) {
      setLocal({
        intervalSeconds: settings.intervalSeconds,
        importanceThreshold: settings.importanceThreshold,
        paused: settings.paused,
        telegramEnabled: settings.telegramEnabled,
        noveltyWeight: settings.novelty.weight,
        noveltyDecay: settings.novelty.decay,
        autonomyEnabled: settings.autonomy.enabled,
        autonomyMaxSources: settings.autonomy.maxSources,
      });
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        data: local
      });
      queryClient.invalidateQueries({ queryKey: getGetEphemeroiSettingsQueryKey() });
      toast({ title: "Settings saved successfully" });
    } catch (err) {
      toast({ title: "Failed to save settings", variant: "destructive" });
    }
  };

  const handleRunCycle = async () => {
    try {
      const res = await runCycle.mutateAsync();
      toast({ 
        title: "Cycle Complete", 
        description: `Observed ${res.observationsAdded}, Updated ${res.beliefsUpdated} beliefs.` 
      });
    } catch (err) {
      toast({ title: "Cycle failed", variant: "destructive" });
    }
  };

  const handleBiomimetic = async () => {
    try {
      const res = await biomimetic.mutateAsync({ data: {} });
      toast({
        title: res.solved ? "Biomimetic: SOLVED" : "Biomimetic: timeout",
        description: `${res.steps} steps · ${res.cageEvents} cage event(s) · ${res.edictCount} edict(s) · ${res.finalUnsat} unsat`,
      });
    } catch (err) {
      toast({ title: "Biomimetic run failed", variant: "destructive" });
    }
  };

  const handleSelfImprove = async () => {
    try {
      const res = await selfImprove.mutateAsync();
      if (res.applied) {
        toast({
          title: "Self-improvement applied",
          description: `${res.file ?? ""}: ${res.rationale ?? ""} — restart api-server to load.`,
        });
      } else {
        toast({
          title: "Self-improvement skipped",
          description: res.error ?? "No actionable change proposed.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: "Self-improvement failed", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 bg-card mb-8" />
        {[1, 2].map(i => <Skeleton key={i} className="h-64 w-full bg-card" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10 pb-20">
      <header className="flex justify-between items-end gap-4">
        <div>
          <h2 className="font-serif text-3xl text-foreground mb-2">Configuration</h2>
          <p className="text-muted-foreground">Tune the observer's cognitive parameters.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="bg-card/40 text-foreground border-border/60 hover:bg-card/70"
            onClick={handleBiomimetic}
            disabled={biomimetic.isPending}
            title="Run one pass of the v0.11.3 biomimetic constraint-field protocol on a synthetic 3-SAT problem. Telemetry to SSE, Don narration on cage."
          >
            <Dna className={`w-4 h-4 mr-2 ${biomimetic.isPending ? 'animate-pulse' : ''}`} />
            {biomimetic.isPending ? "Solving…" : "Biomimetic"}
          </Button>
          <Button
            variant="outline"
            className="bg-card/40 text-foreground border-border/60 hover:bg-card/70"
            onClick={handleSelfImprove}
            disabled={selfImprove.isPending}
            title="Have Ephemeroi read its own source, propose one improvement, verify it builds, and ping Telegram."
          >
            <Wrench className={`w-4 h-4 mr-2 ${selfImprove.isPending ? 'animate-pulse' : ''}`} />
            {selfImprove.isPending ? "Improving…" : "Self-Improve"}
          </Button>
          <Button
            variant="outline"
            className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:text-primary"
            onClick={handleRunCycle}
            disabled={runCycle.isPending}
          >
            <Play className={`w-4 h-4 mr-2 ${runCycle.isPending ? 'animate-pulse' : ''}`} />
            Force Cycle Now
          </Button>
        </div>
      </header>

      <div className="grid gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="w-5 h-5 text-primary" /> Core Operation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Pause Observer</label>
                  <p className="text-xs text-muted-foreground">Stop autonomous cycles (manual runs still work)</p>
                </div>
                <Switch 
                  checked={local.paused}
                  onCheckedChange={v => setLocal({...local, paused: v})}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground"/> Polling Interval
                  </label>
                  <span className="text-xs font-mono text-muted-foreground">{local.intervalSeconds}s</span>
                </div>
                <Slider 
                  min={30} max={3600} step={30}
                  value={[local.intervalSeconds]}
                  onValueChange={v => setLocal({...local, intervalSeconds: v[0]})}
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/50">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Bell className="w-4 h-4 text-muted-foreground"/> Telegram Delivery
                  </label>
                  <p className="text-xs text-muted-foreground">Send reports via configured bot</p>
                </div>
                <Switch 
                  checked={local.telegramEnabled}
                  onCheckedChange={v => setLocal({...local, telegramEnabled: v})}
                />
              </div>

            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="w-5 h-5 text-primary" /> Cognitive Tuning
              </CardTitle>
              <CardDescription>Adjust how the observer values and processes information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              
              <div className="space-y-4">
                <div className="flex justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500/70"/> Importance Threshold
                  </label>
                  <span className="text-xs font-mono text-muted-foreground">{(local.importanceThreshold * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">Only generate reports for reflections scoring above this.</p>
                <Slider 
                  min={0} max={1} step={0.05}
                  value={[local.importanceThreshold]}
                  onValueChange={v => setLocal({...local, importanceThreshold: v[0]})}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Novelty Weight</label>
                  <span className="text-xs font-mono text-muted-foreground">{(local.noveltyWeight * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">How much novelty influences overall importance.</p>
                <Slider 
                  min={0} max={1} step={0.05}
                  value={[local.noveltyWeight]}
                  onValueChange={v => setLocal({...local, noveltyWeight: v[0]})}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Novelty Decay</label>
                  <span className="text-xs font-mono text-muted-foreground">{(local.noveltyDecay * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">How quickly repeated topics become boring.</p>
                <Slider 
                  min={0} max={1} step={0.01}
                  value={[local.noveltyDecay]}
                  onValueChange={v => setLocal({...local, noveltyDecay: v[0]})}
                />
              </div>

            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-primary" /> Autonomy
              </CardTitle>
              <CardDescription>
                Let Ephemeroi follow new GitHub repos and users on its own when it
                spots them in observations. Off by default. Hard cap: at most two
                new sources per cycle, and a total ceiling you can set below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Enable Self-Discovery</label>
                  <p className="text-xs text-muted-foreground">
                    After each cycle's reflection, scan observations for GitHub references and ask the LLM if any are worth watching.
                  </p>
                </div>
                <Switch
                  checked={local.autonomyEnabled}
                  onCheckedChange={v => setLocal({ ...local, autonomyEnabled: v })}
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Max Auto-Added Sources</label>
                  <span className="text-xs font-mono text-muted-foreground">{local.autonomyMaxSources}</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Total ceiling on sources Ephemeroi has added to itself. Once reached, it stops adding.
                </p>
                <Slider
                  min={0} max={200} step={5}
                  value={[local.autonomyMaxSources]}
                  onValueChange={v => setLocal({ ...local, autonomyMaxSources: v[0] })}
                  disabled={!local.autonomyEnabled}
                />
              </div>

            </CardContent>
          </Card>
        </motion.div>

        <div className="flex justify-end pt-4">
          <Button 
            onClick={handleSave} 
            disabled={updateSettings.isPending}
            className="w-full md:w-auto"
          >
            {updateSettings.isPending ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
