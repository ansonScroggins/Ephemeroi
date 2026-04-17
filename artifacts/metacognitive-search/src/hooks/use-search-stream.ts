import { useState, useCallback, useRef } from "react";

export type StreamEvent =
  | { type: 'started'; query: string }
  | { type: 'token'; content: string }
  | { type: 'step'; stepType: 'DECOMPOSE' | 'RETRIEVE' | 'EVALUATE' | 'PIVOT' | 'SYNTHESIZE'; data: any }
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
              
              const event = JSON.parse(eventStr);
              
              if (event.done) {
                setIsRunning(false);
                setActiveStepType(null);
                continue;
              }
              
              if (event.type === 'started') {
                setEvents([{ type: 'started', query: event.query }]);
              } else if (event.type === 'token') {
                setLiveTokenStream(prev => prev + event.content);
              } else if (event.type === 'step') {
                setEvents(prev => [...prev, event]);
                setActiveStepType(event.stepType);
                // Clear live tokens once a step is captured so only in-progress tokens show
                setLiveTokenStream("");
              } else if (event.type === 'complete') {
                setEvents(prev => [...prev, event]);
                setIsRunning(false);
                setActiveStepType(null);
              }
            } catch (err) {
              console.error("Failed to parse SSE event", err);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Search aborted");
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