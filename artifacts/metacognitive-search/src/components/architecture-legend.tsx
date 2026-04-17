import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, Brain, Microscope, Search, Target, Zap } from "lucide-react";

interface ArchitectureLegendProps {
  activeStepType: string | null;
}

const COMPONENTS = [
  {
    id: "DECOMPOSE",
    name: "Query Planner",
    description: "Deconstructs complex questions into solvable sub-tasks",
    icon: Brain,
    colorClass: "text-indigo-400",
    bgClass: "bg-indigo-500/10",
    borderClass: "border-indigo-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(99,102,241,0.5)]",
  },
  {
    id: "RETRIEVE",
    name: "Knowledge Retriever",
    description: "Fetches sources and extracts relevant findings",
    icon: Search,
    colorClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(16,185,129,0.5)]",
  },
  {
    id: "EVALUATE",
    name: "Gap Detector",
    description: "Assesses coverage and identifies missing knowledge",
    icon: AlertTriangle,
    colorClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(245,158,11,0.5)]",
  },
  {
    id: "PIVOT",
    name: "Strategy Selector",
    description: "Adjusts search direction based on evaluated gaps",
    icon: Zap,
    colorClass: "text-rose-400",
    bgClass: "bg-rose-500/10",
    borderClass: "border-rose-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(244,63,94,0.5)]",
  },
  {
    id: "SYNTHESIZE",
    name: "Synthesizer",
    description: "Constructs final answer from gathered evidence",
    icon: Microscope,
    colorClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    borderClass: "border-violet-500/50",
    pulseClass: "shadow-[0_0_15px_rgba(139,92,246,0.5)]",
  }
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
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        {COMPONENTS.map((comp) => {
          const isActive = activeStepType === comp.id;
          const Icon = comp.icon;
          
          return (
            <div 
              key={comp.id}
              className={cn(
                "p-3 rounded-lg border transition-all duration-500 relative overflow-hidden",
                isActive ? cn(comp.bgClass, comp.borderClass, comp.pulseClass) : "border-transparent bg-muted/20"
              )}
              data-testid={`legend-item-${comp.id}`}
            >
              {isActive && (
                <div className={cn("absolute left-0 top-0 bottom-0 w-1 bg-current", comp.colorClass)} />
              )}
              <div className="flex items-center gap-3">
                <div className={cn("p-1.5 rounded-md", isActive ? comp.bgClass : "bg-background")}>
                  <Icon className={cn("h-4 w-4", isActive ? comp.colorClass : "text-muted-foreground")} />
                </div>
                <div>
                  <h4 className={cn("text-xs font-bold uppercase tracking-wider font-mono", isActive ? comp.colorClass : "text-foreground")}>
                    {comp.name}
                  </h4>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
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