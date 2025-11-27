import type { Operator } from "./keep-online";
import { WebSocketIsh } from "./models";

export const createWebSocket = (
  wsUrl: string,
  operator: Operator,
  onMessageFn: (ws: WebSocketIsh, ev: MessageEvent) => void,
): WebSocketIsh => {
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
