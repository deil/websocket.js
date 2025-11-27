export const ConnectionState = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Reconnecting: "reconnecting",
  Limbo: "limbo",
  Connected: "connected",
  Error: "error",
} as const;

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

export interface WebSocketIsh {
  close(): void;
}

export type createWebSocketFn = () => WebSocketIsh;
export type heartbeatFn = (
  ws: WebSocketIsh,
  timeSinceLastHeartbeat: number,
) => void;
