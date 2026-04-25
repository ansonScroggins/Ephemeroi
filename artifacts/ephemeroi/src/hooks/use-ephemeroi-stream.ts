import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEphemeroiStateQueryKey,
  getListEphemeroiObservationsQueryKey,
  getListEphemeroiReportsQueryKey,
  getListEphemeroiBeliefsQueryKey,
  getListEphemeroiContradictionsQueryKey,
  getListEphemeroiSourcesQueryKey,
  getListEphemeroiSourceStatesQueryKey,
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
        } else if (data.type === "source_state") {
          // A source's 4D vector just shifted from a reflection. Refresh
          // the Sources page so the bars + arrows animate to the new
          // position. No toast — these happen often and are cheap.
          queryClient.invalidateQueries({ queryKey: getListEphemeroiSourceStatesQueryKey() });
        } else if (data.type === "constellation_alert") {
          // High-severity event; the Don narration was just composed.
          // Even when Telegram delivery isn't configured, surface a
          // toast so the user notices.
          queryClient.invalidateQueries({ queryKey: getListEphemeroiSourceStatesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListEphemeroiReportsQueryKey() });
          toast({
            title: `Constellation alert — ${data.payload?.sourceLabel ?? "a source"}`,
            description: data.payload?.headline ?? "Something significant just shifted.",
          });
        } else if (data.type === "source_auto_added") {
          // The bot added a new source on its own. Refresh the sources
          // list so it shows up immediately and tell the user why.
          queryClient.invalidateQueries({ queryKey: getListEphemeroiSourcesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEphemeroiStateQueryKey() });
          const label = data.payload?.source?.label || data.payload?.source?.target || "a new source";
          toast({
            title: "Ephemeroi started watching something new",
            description: `${label} — ${data.payload?.reason || "auto-discovered from recent observations"}`,
          });
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
