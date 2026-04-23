import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type MemoryMatch } from "@/lib/memory";

interface MemoryPillProps {
  match: MemoryMatch | null;
  onDismiss: () => void;
  onReuse: (query: string) => void;
}

export function MemoryPill({ match, onDismiss, onReuse }: MemoryPillProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <AnimatePresence>
      {match && (
        <motion.div
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 8, height: 0 }}
          transition={{ duration: 0.2 }}
          className="px-3 pt-2"
          data-testid="memory-pill"
        >
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 backdrop-blur overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover-elevate active-elevate-2"
              data-testid="button-memory-toggle"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-amber-200/95 leading-tight">
                  I've thought about something like this before
                </div>
                <div className="text-[10px] text-amber-200/60 font-mono">
                  {formatRelativeTime(match.entry.timestamp)} · {Math.round(match.similarity * 100)}% similar
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-amber-200/60 transition-transform",
                  expanded && "rotate-180"
                )}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="ml-1 p-1 rounded-md hover:bg-amber-400/10"
                aria-label="Dismiss"
                data-testid="button-memory-dismiss"
              >
                <X className="h-3 w-3 text-amber-200/60" />
              </button>
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-t border-amber-400/20"
                  data-testid="memory-detail"
                >
                  <div className="px-3 py-2.5 space-y-2">
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-amber-200/60 font-mono mb-0.5">
                        you asked
                      </div>
                      <div className="text-[12px] text-foreground/90 italic">
                        "{match.entry.query}"
                      </div>
                    </div>

                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-amber-200/60 font-mono mb-0.5">
                        what I concluded
                      </div>
                      <div className="text-[12px] text-foreground/85 leading-relaxed">
                        {match.entry.summary}
                      </div>
                    </div>

                    {(match.entry.confidence !== null || match.entry.lensesUsed.length > 0) && (
                      <div className="flex items-center gap-3 text-[10px] font-mono text-amber-200/60 pt-1">
                        {match.entry.confidence !== null && (
                          <span>confidence {(match.entry.confidence * 100).toFixed(0)}%</span>
                        )}
                        {match.entry.lensesUsed.length > 0 && (
                          <span>lenses: {match.entry.lensesUsed.map((l) => l.toLowerCase()).join(", ")}</span>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onReuse(match.entry.query)}
                      className="text-[11px] text-amber-200 hover:text-amber-100 underline underline-offset-2 pt-1"
                      data-testid="button-memory-reuse"
                    >
                      use that exact question →
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
