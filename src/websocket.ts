import type { GreatWebSocketEventMap } from "./events";
import type { PendingCommand } from "./internal";
import { AlwaysConnected, type Operator } from "./keep-online";
import { ConnectionState, type heartbeatFn } from "./models";
import type { RemoteCommand } from "./rpc";
import { createWebSocket } from "./websocket-factory";

export class GreatWebSocket implements Operator {
  #client: unknown | null = null;
  #ws: AlwaysConnected | null = null;
  #pendingCommands: PendingCommand[] = [];

  get client(): unknown | null {
    return this.#client;
  }

  get websocket(): WebSocket | null {
    return this.#ws?.websocket ?? null;
  }

  constructor(
    url: string,
    private readonly onConnectedFn: () => Promise<boolean>,
    private readonly onMessageFn: (ws: WebSocket, ev: MessageEvent) => void,
    private readonly sendHeartbeat: heartbeatFn,
    client: unknown | null,
  ) {
    this.#client = client;
    this.#ws = new AlwaysConnected(
      () => createWebSocket(url, this, this.onMessageFn),
      this.onConnectedFn,
      this.sendHeartbeat,
      { heartbeatInterval: 15000, reconnectDelay: 2000, connectionTimeout: 15000 },
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

  handleWebSocketOpen() {
    this.#ws?.handleWebSocketOpen();
  }

  handleWebSocketError(ws: WebSocket) {
    this.#ws?.handleWebSocketError(ws);
  }

  handleWebSocketClosed(ws: WebSocket) {
    this.#ws?.handleWebSocketClosed(ws);
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

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.#ws?.websocket?.send(data);
  }

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
