import {
  ConnectionStateChangeEvent,
  type GreatWebSocketEventMap,
} from "./events";
import {
  ConnectionState,
  type createWebSocketFn,
  type heartbeatFn,
} from "./models";

export interface Operator {
  handleWebSocketOpen(): void;
  handleWebSocketClosed(ws: WebSocket): void;
  handleWebSocketError(ws: WebSocket): void;
  handleWebSocketHeartbeatTimeout(): void;
}

export class AlwaysConnected extends EventTarget implements Operator {
  private readonly CONNECTION_TIMEOUT = 15000;
  private readonly RECONNECT_DELAY = 5000;
  private readonly HEARTBEAT_INTERVAL = 15000;

  #active = false;
  #ws: WebSocket | null = null;
  #state = ConnectionState.Disconnected;
  #connectionWatchdog: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimeout: ReturnType<typeof setInterval> | null = null;

  get websocket(): WebSocket | null {
    return this.#ws;
  }

  constructor(
    private readonly createWs: createWebSocketFn,
    private readonly onConnectedFn: () => Promise<boolean>,
    private readonly sendHeartbeat: heartbeatFn,
  ) {
    super();
  }

  /**
   * Whether the WebSocket is activated and running
   */
  get active() {
    return this.#active;
  }

  /**
   * Actual state of the WebSocket connection
   */
  get state() {
    return this.#state;
  }

  /**
   * Activate - initiate the WebSocket connection and keep it alive
   */
  activate() {
    if (this.#active) {
      throw new Error("Already active");
    }

    this.#active = true;

    this.#heartbeatTimeout = setInterval(() => {
      if (
        !this.active ||
        this.#state !== ConnectionState.Connected ||
        this.#ws == null
      ) {
        return;
      }

      this.sendHeartbeat(this.#ws, this.HEARTBEAT_INTERVAL);
    }, this.HEARTBEAT_INTERVAL);

    this.#ws = this.createWs();
  }

  /**
   * Shutdown - stop and disconnect the WebSocket
   */
  shutdown() {
    if (this.#heartbeatTimeout != null) {
      clearInterval(this.#heartbeatTimeout);
      this.#heartbeatTimeout = null;
    }

    this.stopConnectionWatchdog();
    this.#active = false;
    this.#ws?.close();
  }

  handleWebSocketOpen() {
    this.transitionToState(ConnectionState.Limbo);

    this.onConnectedFn().then((success) => {
      if (success) {
        this.transitionToState(ConnectionState.Connected);
      }
    });
  }

  handleWebSocketError(ws: WebSocket) {
    this.reconnectIfNeeded(ws);
  }

  handleWebSocketClosed(ws: WebSocket) {
    this.reconnectIfNeeded(ws);
  }

  /**
   * Notify the WebSocket that the application-level heartbeat timeout has occurred. Will trigger a reconnect
   */
  handleWebSocketHeartbeatTimeout() {
    this.reconnectIfNeeded();
  }

  private startConnectionWatchdog() {
    this.#connectionWatchdog = setTimeout(() => {
      this.dispatchEvent(new Event("connectiontimeout"));
      this.reconnectIfNeeded();
    }, this.CONNECTION_TIMEOUT);
  }

  private stopConnectionWatchdog() {
    if (this.#connectionWatchdog != null) {
      clearTimeout(this.#connectionWatchdog);
      this.#connectionWatchdog = null;
    }
  }

  private transitionToState(state: ConnectionState) {
    if (this.#state === state) {
      return;
    }

    this.#state = state;

    if (this.#state === ConnectionState.Limbo) {
      this.startConnectionWatchdog();
    } else if (this.#state === ConnectionState.Connected) {
      this.stopConnectionWatchdog();
    }

    this.dispatchEvent(new ConnectionStateChangeEvent(state));
  }

  private reconnectIfNeeded(eventTarget: WebSocket | null = null) {
    if (eventTarget != null && eventTarget !== this.#ws) {
      return;
    }

    if (!this.active) {
      this.transitionToState(ConnectionState.Disconnected);
      return;
    }

    this.transitionToState(ConnectionState.Reconnecting);
    this.stopConnectionWatchdog();
    this.#ws?.close();
    this.#ws = null;

    setTimeout(() => {
      if (!this.active || this.#ws != null) {
        return;
      }

      this.#ws = this.createWs();
    }, this.RECONNECT_DELAY);
  }

  addEventListener<K extends keyof GreatWebSocketEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof GreatWebSocketEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}
