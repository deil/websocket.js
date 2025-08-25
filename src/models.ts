export enum ConnectionState {
	Disconnected = "disconnected",
	Connecting = "connecting",
	Reconnecting = "reconnecting",
	Limbo = "limbo",
	Connected = "connected",
	Error = "error",
}

export interface IWebSocket {

}

export interface RemoteCommand {
	execute(ws: IWebSocket): string;
	responseMatches: (json: unknown) => boolean;
	handleResponse(json: unknown): unknown;
}

export type ResponseMatcher = (message: unknown, messageId: string) => boolean;
