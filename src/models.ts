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

	onMessage(ev: MessageEvent): void;
}

export type createWebSocketFn = () => WebSocket;

export interface RemoteCommand {
	execute(ws: IWebSocket): string;
	responseMatches: (json: unknown) => boolean;
	handleResponse(json: unknown): unknown;
}

export type ResponseMatcher = (message: unknown, messageId: string) => boolean;
