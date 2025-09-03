import type { GreatWebSocket } from "./websocket";

export interface RemoteCommand {
  execute(ws: GreatWebSocket): string;
  responseMatches: (json: unknown) => boolean;
  handleResponse(json: unknown): unknown;
}

export type ResponseMatcher = (message: unknown, messageId: string) => boolean;
