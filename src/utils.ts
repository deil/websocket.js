import type { Operator } from "./keep-online";

export const createWebSocket = (
  wsUrl: string,
  operator: Operator,
  onMessageFn: (ws: WebSocket, ev: MessageEvent) => void,
): WebSocket => {
  const ws = new WebSocket(wsUrl);
  ws.onerror = (error) => {
    console.error("WS error: ", error);
    operator.handleWebSocketError(ws);
  };

  ws.onopen = async () => {
    console.log("Websocket connected");

    ws.onclose = (ev) => {
      console.log("WS closed: ", ev.reason, ev);
      operator.handleWebSocketClosed(ws);
    };

    ws.onmessage = (ev) => {
      onMessageFn(ws, ev);
    };

    operator.handleWebSocketOpen();
  };

  return ws;
};
