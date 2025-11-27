import type { GreatWebSocketEventMap } from "./events";
import type { PendingCommand } from "./internal";
import { AlwaysConnected } from "./keep-online";
import { ConnectionState, type heartbeatFn } from "./models";
import type { RemoteCommand } from "./rpc";
import { createWebSocket, type Operator } from "./websocket-factory";

export class GreatWebSocket implements Operator {
  #ws: AlwaysConnected | null = null;
  #pendingCommands: PendingCommand[] = [];

  constructor(
    url: string,
    private readonly onConnectedFn: () => Promise<boolean>,
    private readonly onMessageFn: (ws: WebSocket, ev: MessageEvent) => void,
    private readonly sendHeartbeat: heartbeatFn,
  ) {
    this.#ws = new AlwaysConnected(
      () =>
        createWebSocket(
          url,
          this,
          this.onMessageFn as (ws: unknown, ev: MessageEvent) => void,
        ),
      this.onConnectedFn,
      this.sendHeartbeat,
      {
        heartbeatInterval: 15000,
        reconnectDelay: 2000,
        connectionTimeout: 15000,
      },
    );
  }

  /**
   * Whether the WebSocket is activated and running
   */
  get active() {
    return this.#ws?.active ?? false;
  }

  /**
   * Actual state of the WebSocket connection
   */
  get state() {
    return this.#ws?.state ?? ConnectionState.Disconnected;
  }

  /**
   * The underlying WebSocket instance
   */
  get websocket(): WebSocket | null {
    return (this.#ws?.websocket as WebSocket) ?? null;
  }

  /**
   * Activate - initiate the WebSocket connection and keep it alive
   */
  activate() {
    this.#ws?.activate();
  }

  /**
   * Shutdown - stop and disconnect the WebSocket
   */
  shutdown() {
    this.#ws?.shutdown();
  }

  /**
   * Notify the WebSocket that the application-level heartbeat timeout has occurred. Will trigger a reconnect
   */
  handleWebSocketHeartbeatTimeout() {
    this.#ws?.handleWebSocketHeartbeatTimeout();
  }

  //#region Events

  addEventListener<K extends keyof GreatWebSocketEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.#ws?.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof GreatWebSocketEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    this.#ws?.removeEventListener(type, listener, options);
  }

  //#endregion

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): boolean {
    if (!this.isConnected()) {
      return false;
    }

    this.websocket?.send(data);
    return true;
  }

  //#region RPC

  call(command: RemoteCommand): Promise<unknown> {
    const cmd = {
      command,
      executedAt: Date.now(),
    } as PendingCommand;

    return new Promise((resolve, reject) => {
      this.#pendingCommands.push(cmd);

      cmd.promise = { resolve, reject };
      cmd.rpcId = command.execute(this);
    });
  }

  /**
   * Dispatch an incoming message to a pending RPC command.
   *
   * Call this from your `onMessageFn` callback after parsing the message.
   * If the message matches a pending command, the command's promise is resolved
   * and this returns `true`. Otherwise, returns `false` and you should handle
   * the message yourself (e.g., as an event or notification).
   *
   * @param message - The parsed message to dispatch
   * @returns `true` if the message was handled as an RPC response, `false` otherwise
   */
  tryHandleAsControlMessage(message: unknown): boolean {
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

  //#endregion

  //#region Internals

  private isConnected(): boolean {
    return this.state === ConnectionState.Connected;
  }

  handleWebSocketOpen() {
    this.#ws?.handleWebSocketOpen();
  }

  handleWebSocketError(ws: WebSocket) {
    this.#ws?.handleWebSocketError(ws);
  }

  handleWebSocketClosed(ws: WebSocket) {
    this.#ws?.handleWebSocketClosed(ws);
  }

  //#endregion
}
