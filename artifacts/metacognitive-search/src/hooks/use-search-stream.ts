import { useState, useCallback, useRef } from "react";

export type SearchMode = "research" | "code" | "web";

export interface DecomposePayload {
  subQuestions: string[];
  rationale: string;
  strategy: 'breadth_first' | 'depth_first' | 'comparative';
}

export type ReasoningLens = 'VISIBLE' | 'INFRARED' | 'UV' | 'PRISM';

export interface RetrievePayload {
  subQuestion: string;
  sourceType: 'empirical' | 'theoretical' | 'computational' | 'clinical' | 'review';
  findings: string;
  confidence: number;
  references: string[];
  lens?: ReasoningLens;
  lensRationale?: string;
}

export interface EvaluatePayload {
  coverageAssessment: string;
  overallConfidence: number;
  gaps: string[];
  conflictDetected: boolean;
  conflictDescription: string | null;
}

export interface PivotPayload {
  trigger: string;
  oldDirection: string;
  newDirection: string;
  rationale: string;
}

export interface SynthesizePayload {
  answer: string;
  finalConfidence: number;
  keyFindings: string[];
  openQuestions: string[];
  furtherReading: string[];
}

export interface WebSource {
  index: number;
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchPayload {
  query: string;
  sources: WebSource[];
  totalSources: number;
  status?: 'searching';
}

export interface DetectedPattern {
  theme: string;
  frequency: number;
  supportingSources: number[];
}

export interface PatternPayload {
  patterns: DetectedPattern[];
  dominantThemes: string[];
  outliers: string[];
}

export interface ReflectPayload {
  personalSummary: string;
  interestingObservations: string[];
  autonomousExplorations: string[];
  selfAssessment: string;
}

export type StepData =
  | { stepType: 'DECOMPOSE'; data: DecomposePayload }
  | { stepType: 'RETRIEVE'; data: RetrievePayload }
  | { stepType: 'EVALUATE'; data: EvaluatePayload }
  | { stepType: 'PIVOT'; data: PivotPayload }
  | { stepType: 'SYNTHESIZE'; data: SynthesizePayload }
  | { stepType: 'WEB_SEARCH'; data: WebSearchPayload }
  | { stepType: 'PATTERN'; data: PatternPayload }
  | { stepType: 'REFLECT'; data: ReflectPayload };

export type StreamEvent =
  | { type: 'started'; query: string }
  | { type: 'token'; content: string }
  | ({ type: 'step' } & StepData)
  | { type: 'complete'; totalSteps: number; rawResponse: string }
  | { type: 'error'; message: string };

export interface StartSearchOptions {
  query: string;
  mode?: SearchMode;
  code?: string;
}

export function useSearchStream() {
  const [isRunning, setIsRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [liveTokenStream, setLiveTokenStream] = useState("");
  const [activeStepType, setActiveStepType] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);

  const startSearch = useCallback(async (opts: StartSearchOptions) => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }

    setQuery(opts.query);
    setEvents([]);
    setLiveTokenStream("");
    setIsRunning(true);
    setActiveStepType(null);

    const abortController = new AbortController();
    activeAbortController.current = abortController;

    try {
      const body: Record<string, unknown> = { query: opts.query, mode: opts.mode ?? "research" };
      if (opts.mode === "code" && opts.code) body['code'] = opts.code;

      const response = await fetch('/api/search/metacognitive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const message = `Request failed (${response.status}): ${errorText}`;
        setEvents(prev => [...prev, { type: 'error', message }]);
        setIsRunning(false);
        return;
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          setIsRunning(false);
          setActiveStepType(null);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventStr = line.slice(6).trim();
              if (!eventStr) continue;

              const raw: unknown = JSON.parse(eventStr);
              if (typeof raw !== 'object' || raw === null) continue;
              const event = raw as Record<string, unknown>;

              if (event['done'] === true) {
                setIsRunning(false);
                setActiveStepType(null);
                continue;
              }

              if (event['type'] === 'started' && typeof event['query'] === 'string') {
                setEvents([{ type: 'started', query: event['query'] }]);
              } else if (event['type'] === 'token' && typeof event['content'] === 'string') {
                setLiveTokenStream(prev => prev + (event['content'] as string));
              } else if (event['type'] === 'step') {
                const stepEvent = event as { type: 'step'; stepType: string; data: unknown };
                // Skip the placeholder "searching" WEB_SEARCH event from being added to history
                // (it's just to flip the active indicator). The real one with sources replaces it.
                const isSearchingPlaceholder =
                  stepEvent.stepType === 'WEB_SEARCH' &&
                  (stepEvent.data as { status?: string })?.status === 'searching';
                if (!isSearchingPlaceholder) {
                  setEvents(prev => [...prev, stepEvent as StreamEvent]);
                }
                if (typeof stepEvent.stepType === 'string') {
                  setActiveStepType(stepEvent.stepType);
                }
                setLiveTokenStream("");
              } else if (event['type'] === 'complete') {
                const completeEvent = event as { type: 'complete'; totalSteps: number; rawResponse: string };
                setEvents(prev => [...prev, completeEvent]);
                setIsRunning(false);
                setActiveStepType(null);
              } else if (event['type'] === 'error' && typeof event['message'] === 'string') {
                setEvents(prev => [...prev, { type: 'error', message: event['message'] as string }]);
                setIsRunning(false);
                setActiveStepType(null);
              }
            } catch (parseErr) {
              console.error("Failed to parse SSE event", parseErr);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User-initiated cancellation — no error state needed
      } else {
        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        setEvents(prev => [...prev, { type: 'error', message }]);
        setIsRunning(false);
        setActiveStepType(null);
      }
    }
  }, []);

  const stopSearch = useCallback(() => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
      activeAbortController.current = null;
    }
    setIsRunning(false);
    setActiveStepType(null);
  }, []);

  return {
    startSearch,
    stopSearch,
    isRunning,
    query,
    events,
    liveTokenStream,
    activeStepType
  };
}
