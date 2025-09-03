export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Reconnecting = "reconnecting",
  Limbo = "limbo",
  Connected = "connected",
  Error = "error",
}

export type createWebSocketFn = () => WebSocket;
export type heartbeatFn = (
  ws: WebSocket,
  timeSinceLastHeartbeat: number,
) => void;
