import type { IWebSocket } from "./models";

export interface RemoteCommand {
  execute(ws: IWebSocket): string;
  responseMatches: (json: unknown) => boolean;
  handleResponse(json: unknown): unknown;
}

export type ResponseMatcher = (message: unknown, messageId: string) => boolean;
