import {
  ConnectionStateChangeEvent,
  type GreatWebSocketEventMap,
} from "./events";
import {
  ConnectionState,
  WebSocketIsh,
  type ConnectionState as ConnectionStateType,
  type createWebSocketFn,
  type heartbeatFn,
} from "./models";

export interface Operator {
  handleWebSocketOpen(): void;
  handleWebSocketClosed(ws: WebSocket): void;
  handleWebSocketError(ws: WebSocket): void;
  handleWebSocketHeartbeatTimeout(): void;
}

export interface AlwaysConnectedOptions {
  heartbeatInterval: number;
  reconnectDelay: number;
  connectionTimeout: number;
}

export class AlwaysConnected extends EventTarget implements Operator {

  #active = false;
  #ws: WebSocketIsh | null = null;
  #state: ConnectionStateType = ConnectionState.Disconnected;
  #connectionWatchdog: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimeout: ReturnType<typeof setInterval> | null = null;
  #connectionToken: object | null = null;

  get websocket(): WebSocketIsh | null {
    return this.#ws;
  }

  constructor(
    private readonly createWs: createWebSocketFn,
    private readonly onConnectedFn: () => Promise<boolean>,
    private readonly sendHeartbeat: heartbeatFn,
    private readonly options: AlwaysConnectedOptions,
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
    this.transitionToState(ConnectionState.Connecting);

    this.#heartbeatTimeout = setInterval(() => {
      if (
        !this.active ||
        this.#state !== ConnectionState.Connected ||
        this.#ws == null
      ) {
        return;
      }

      this.sendHeartbeat(this.#ws, this.options.heartbeatInterval);
    }, this.options.heartbeatInterval);

    this.#ws = this.createWs();
  }

  /**
   * Shutdown - stop and disconnect the WebSocket
   */
  shutdown() {
    this.#connectionToken = null;
    if (this.#heartbeatTimeout != null) {
      clearInterval(this.#heartbeatTimeout);
      this.#heartbeatTimeout = null;
    }

    this.stopConnectionWatchdog();
    this.#active = false;
    this.#ws?.close();
    this.#state = ConnectionState.Disconnected;
  }

  handleWebSocketOpen() {
    const connectionToken = {};
    this.#connectionToken = connectionToken;
    this.transitionToState(ConnectionState.Limbo);

    this.onConnectedFn().then((success) => {
      if (this.#connectionToken !== connectionToken) {
        return;
      }

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
    }, this.options.connectionTimeout);
  }

  private stopConnectionWatchdog() {
    if (this.#connectionWatchdog != null) {
      clearTimeout(this.#connectionWatchdog);
      this.#connectionWatchdog = null;
    }
  }

  private transitionToState(state: ConnectionStateType) {
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

    this.#connectionToken = null;
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
    }, this.options.reconnectDelay);
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
