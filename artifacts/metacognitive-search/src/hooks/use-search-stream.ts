import { useState, useCallback, useRef } from "react";

export interface DecomposePayload {
  subQuestions: string[];
  rationale: string;
  strategy: 'breadth_first' | 'depth_first' | 'comparative';
}

export interface RetrievePayload {
  subQuestion: string;
  sourceType: 'empirical' | 'theoretical' | 'computational' | 'clinical' | 'review';
  findings: string;
  confidence: number;
  references: string[];
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

export type StepData =
  | { stepType: 'DECOMPOSE'; data: DecomposePayload }
  | { stepType: 'RETRIEVE'; data: RetrievePayload }
  | { stepType: 'EVALUATE'; data: EvaluatePayload }
  | { stepType: 'PIVOT'; data: PivotPayload }
  | { stepType: 'SYNTHESIZE'; data: SynthesizePayload };

export type StreamEvent =
  | { type: 'started'; query: string }
  | { type: 'token'; content: string }
  | ({ type: 'step' } & StepData)
  | { type: 'complete'; totalSteps: number; rawResponse: string };

export function useSearchStream() {
  const [isRunning, setIsRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [liveTokenStream, setLiveTokenStream] = useState("");
  const [activeStepType, setActiveStepType] = useState<string | null>(null);
  
  const activeAbortController = useRef<AbortController | null>(null);

  const startSearch = useCallback(async (searchQuery: string) => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    
    setQuery(searchQuery);
    setEvents([]);
    setLiveTokenStream("");
    setIsRunning(true);
    setActiveStepType(null);
    
    const abortController = new AbortController();
    activeAbortController.current = abortController;

    try {
      const response = await fetch('/api/search/metacognitive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
        signal: abortController.signal
      });

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
                setEvents(prev => [...prev, stepEvent as StreamEvent]);
                if (typeof stepEvent.stepType === 'string') {
                  setActiveStepType(stepEvent.stepType);
                }
                setLiveTokenStream("");
              } else if (event['type'] === 'complete') {
                const completeEvent = event as { type: 'complete'; totalSteps: number; rawResponse: string };
                setEvents(prev => [...prev, completeEvent]);
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
        console.error("Search stream failed:", err);
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
