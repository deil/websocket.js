export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Reconnecting = "reconnecting",
  Limbo = "limbo",
  Connected = "connected",
  Error = "error",
}

export interface IWebSocket {
  isConnected(): boolean;
  reconnect(): void;

  heartbeat(): void;
  close(): void;
}

export type createWebSocketFn = () => WebSocket;
