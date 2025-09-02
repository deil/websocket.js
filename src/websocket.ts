import {
  ConnectionStateChangeEvent,
  type GreatWebSocketEventMap,
} from "./events";
import type { PendingCommand } from "./internal";
import type { Operator } from "./keep-online";
import { ConnectionState, type IWebSocket } from "./models";
import type { RemoteCommand } from "./rpc";

export class GreatWebSocket extends EventTarget implements Operator {
  private readonly CONNECTION_TIMEOUT = 15000;
  private readonly RECONNECT_DELAY = 5000;
  private readonly HEARTBEAT_INTERVAL = 15000;

  #active = false;
  #state = ConnectionState.Disconnected;
  #connectionWatchdog: number | null = null;
  #heartbeatTimeout: number | null = null;
  #pendingCommands: PendingCommand[] = [];

  constructor(
    private readonly ws: IWebSocket,
    private readonly onConnectedFn: () => Promise<boolean>,
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
    this.#active = true;

    this.#heartbeatTimeout = setInterval(() => {
      if (!this.active || !this.ws.isConnected()) {
        return;
      }

      this.ws.heartbeat();
    }, this.HEARTBEAT_INTERVAL);

    this.ws.reconnect();
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
  }

  handleWebSocketOpen() {
    this.transitionToState(ConnectionState.Limbo);

    this.onConnectedFn().then((success) => {
      if (success) {
        this.transitionToState(ConnectionState.Connected);
      }
    });
  }

  handleWebSocketError() {
    this.reconnectIfNeeded();
  }

  handleWebSocketClosed() {
    this.reconnectIfNeeded();
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

  private reconnectIfNeeded() {
    /*
		if (eventTarget !== this.#ws) {
	      return;
    	}
		*/

    if (!this.active) {
      this.transitionToState(ConnectionState.Disconnected);
      return;
    }

    this.transitionToState(ConnectionState.Reconnecting);
    this.stopConnectionWatchdog();
    this.ws.close();

    setTimeout(() => {
      if (!this.active || this.ws.isConnected()) {
        return;
      }

      this.ws.reconnect();
    }, this.RECONNECT_DELAY);
  }

  //#region Events

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

  //#endregion

  call(command: RemoteCommand): Promise<unknown> {
    const cmd = {
      command,
      executedAt: Date.now(),
    } as PendingCommand;

    return new Promise((resolve, reject) => {
      this.#pendingCommands.push(cmd);

      cmd.promise = { resolve, reject };
      cmd.rpcId = command.execute(this.ws);
    });
  }

  handleMessage(message: unknown): boolean {
    const matchedCommand = this.#pendingCommands.find((cmd) =>
      cmd.command.responseMatches(message),
    );

    if (matchedCommand != null) {
      const result = matchedCommand.command.handleResponse(message);
      const elapsed = Date.now() - matchedCommand.executedAt;
      console.log(
        `Command ${matchedCommand.command.constructor.name} completed in ${elapsed} ms`,
      );

      matchedCommand.promise.resolve(result);
      this.#pendingCommands = this.#pendingCommands.filter(
        (cmd) => cmd !== matchedCommand,
      );

      return true;
    }

    return false;
  }
}
