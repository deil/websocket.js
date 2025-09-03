export const ConnectionState = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Reconnecting: "reconnecting",
  Limbo: "limbo",
  Connected: "connected",
  Error: "error",
} as const;

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

export type createWebSocketFn = () => WebSocket;
export type heartbeatFn = (
  ws: WebSocket,
  timeSinceLastHeartbeat: number,
) => void;
