import { EventEmitter } from "node:events";

export type EphemeroiEventType =
  | "observation"
  | "report"
  | "belief"
  | "contradiction"
  | "cycle"
  | "source_auto_added"
  | "source_state"
  | "constellation_alert";

export interface EphemeroiEvent {
  type: EphemeroiEventType;
  payload: unknown;
}

class EphemeroiBus extends EventEmitter {
  publish(event: EphemeroiEvent): void {
    this.emit("event", event);
  }
}

export const bus: EphemeroiBus = new EphemeroiBus();
bus.setMaxListeners(50);
