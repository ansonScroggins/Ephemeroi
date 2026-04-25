import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEphemeroiStateQueryKey,
  getListEphemeroiObservationsQueryKey,
  getListEphemeroiReportsQueryKey,
  getListEphemeroiBeliefsQueryKey,
  getListEphemeroiContradictionsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function useEphemeroiStream() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    // Connect to the SSE stream. Use absolute path for reliability
    const url = new URL("../api/ephemeroi/stream", document.baseURI).toString();
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Invalidate queries based on event type
        if (data.type === "observation") {
          queryClient.invalidateQueries({ queryKey: getListEphemeroiObservationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
        } else if (data.type === "report") {
          queryClient.invalidateQueries({ queryKey: getListEphemeroiReportsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
          toast({
            title: "New Report Generated",
            description: data.payload?.headline || "Ephemeroi has published a new report.",
          });
        } else if (data.type === "belief") {
          queryClient.invalidateQueries({ queryKey: getListEphemeroiBeliefsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
        } else if (data.type === "contradiction") {
          queryClient.invalidateQueries({ queryKey: getListEphemeroiContradictionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
          toast({
            title: "Contradiction Detected",
            description: "Ephemeroi noticed conflicting information.",
            variant: "destructive"
          });
        } else if (data.type === "cycle") {
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
        }
      } catch (err) {
        console.error("Error parsing SSE message:", err);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE Error:", error);
      // EventSource auto-reconnects, but we can log it
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, toast]);
}
