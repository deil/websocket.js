import type { RemoteCommand } from "./rpc";

export interface PendingCommand {
  command: RemoteCommand;
  executedAt: number;
  rpcId?: string;
  promise: {
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  };
}
