import type { ConnectionState as ConnectionStateType } from "./models";
import { ConnectionState } from "./models";

export interface GreatWebSocketEventMap {
  statechange: ConnectionStateChangeEvent;
  connectiontimeout: Event;
}

export class ConnectionStateChangeEvent extends Event {
  #state: ConnectionStateType;

  constructor(state: ConnectionStateType) {
    super("statechange");
    this.#state = state;
  }

  get state() {
    return this.#state;
  }
}
