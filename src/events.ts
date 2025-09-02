import type { ConnectionState } from "./models";

export interface GreatWebSocketEventMap {
  statechange: ConnectionStateChangeEvent;
  connectiontimeout: Event;
}

export class ConnectionStateChangeEvent extends Event {
  #state: ConnectionState;

  constructor(state: ConnectionState) {
    super("statechange");
    this.#state = state;
  }

  get state() {
    return this.#state;
  }
}
