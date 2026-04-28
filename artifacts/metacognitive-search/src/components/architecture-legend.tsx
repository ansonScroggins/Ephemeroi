import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, Brain, Globe, Layers, Microscope, Search, Sparkles, Target, Zap } from "lucide-react";

interface ArchitectureLegendProps {
  activeStepType: string | null;
}

const COMPONENTS = [
  {
    id: "WEB_SEARCH",
    name: "Web Retriever",
    description: "Fetches real live sources from the web (web mode)",
    icon: Globe,
    colorClass: "text-cyan-400",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(6,182,212,0.5)]",
  },
  {
    id: "DECOMPOSE",
    name: "Query Planner",
    description: "Deconstructs questions or code into sub-tasks",
    icon: Brain,
    colorClass: "text-indigo-400",
    bgClass: "bg-indigo-500/10",
    borderClass: "border-indigo-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(99,102,241,0.5)]",
  },
  {
    id: "PATTERN",
    name: "Pattern Recognizer",
    description: "Detects recurring themes across web sources",
    icon: Layers,
    colorClass: "text-fuchsia-400",
    bgClass: "bg-fuchsia-500/10",
    borderClass: "border-fuchsia-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(217,70,239,0.5)]",
  },
  {
    id: "RETRIEVE",
    name: "Knowledge Retriever",
    description: "Extracts findings per sub-question",
    icon: Search,
    colorClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(16,185,129,0.5)]",
  },
  {
    id: "EVALUATE",
    name: "Gap Detector",
    description: "Assesses coverage, surfaces issues",
    icon: AlertTriangle,
    colorClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(245,158,11,0.5)]",
  },
  {
    id: "PIVOT",
    name: "Strategy Selector",
    description: "Adjusts direction when gaps require it",
    icon: Zap,
    colorClass: "text-rose-400",
    bgClass: "bg-rose-500/10",
    borderClass: "border-rose-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(244,63,94,0.5)]",
  },
  {
    id: "SYNTHESIZE",
    name: "Synthesizer",
    description: "Composes the final answer or refactored code",
    icon: Microscope,
    colorClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    borderClass: "border-violet-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(139,92,246,0.5)]",
  },
  {
    id: "REFLECT",
    name: "Self-Reflector",
    description: "First-person summary, opinions, and autonomous explorations",
    icon: Sparkles,
    colorClass: "text-amber-300",
    bgClass: "bg-amber-400/10",
    borderClass: "border-amber-400/50",
    pulseClass: "shadow-[0_0_15px_rgba(251,191,36,0.5)]",
  },
];

export function ArchitectureLegend({ activeStepType }: ArchitectureLegendProps) {
  return (
    <Card className="bg-card border-border h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Target className="h-4 w-4" />
          System Architecture
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 flex-1 flex flex-col gap-2 overflow-y-auto">
        {COMPONENTS.map((comp) => {
          const isActive = activeStepType === comp.id;
          const Icon = comp.icon;

          return (
            <div
              key={comp.id}
              className={cn(
                "p-2.5 rounded-lg border transition-all duration-500 relative overflow-hidden",
                isActive ? cn(comp.bgClass, comp.borderClass, comp.pulseClass) : "border-transparent bg-muted/20"
              )}
              data-testid={`legend-item-${comp.id}`}
            >
              {isActive && (
                <div className={cn("absolute left-0 top-0 bottom-0 w-1 bg-current", comp.colorClass)} />
              )}
              <div className="flex items-center gap-2.5">
                <div className={cn("p-1.5 rounded-md", isActive ? comp.bgClass : "bg-background")}>
                  <Icon className={cn("h-3.5 w-3.5", isActive ? comp.colorClass : "text-muted-foreground")} />
                </div>
                <div className="min-w-0">
                  <h4 className={cn("text-[10px] font-bold uppercase tracking-wider font-mono truncate", isActive ? comp.colorClass : "text-foreground")}>
                    {comp.name}
                  </h4>
                  <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">
                    {comp.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
