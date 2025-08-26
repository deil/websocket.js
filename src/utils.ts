import { GreatWebSocket } from "./websocket";

export const createWebSocket = (
	wsUrl: string,
	wrapper: GreatWebSocket,
): WebSocket => {
	const ws = new WebSocket(wsUrl);
	ws.onerror = (error) => {
		console.error("WS error: ", error);
		wrapper.handleWebSocketError();
	};

	ws.onopen = async () => {
		console.log("Websocket connected");

		ws.onclose = (ev) => {
			console.log("WS closed: ", ev.reason, ev);
			wrapper.handleWebSocketClosed();
		};

		ws.onmessage = (ev) => {
			try {
				wrapper.handleMessageReceived(ws, ev);
			} catch (e) {
				console.error("Error processing received message: ", e);
			}
		};

		wrapper.handleWebSocketOpen();
	};

	return ws;
};
