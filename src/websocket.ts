import type { IWebSocket, RemoteCommand } from "./models";

interface PendingCommand {
	command: RemoteCommand;
	executedAt: number;
	rpcId?: string;
	promise: {
		resolve: (result: unknown) => void;
		reject: (error: unknown) => void;
	};
}

export class GreatWebSocket {
	#pendingCommands: PendingCommand[] = [];

    constructor(private readonly ws: IWebSocket) {
    }

	call(command: RemoteCommand): Promise<unknown> {
		const cmd = {
			command,
			executedAt: Date.now(),
		} as PendingCommand;

		return new Promise((resolve, reject) => {
			this.#pendingCommands.push(cmd);

			cmd.promise = { resolve, reject };
			cmd.rpcId = command.execute(this.ws);
		});
	}

	handleMessage(message: unknown): boolean {
		const matchedCommand = this.#pendingCommands.find((cmd) =>
			cmd.command.responseMatches(message),
		);

		if (matchedCommand != null) {
			const result = matchedCommand.command.handleResponse(message);
			const elapsed = Date.now() - matchedCommand.executedAt;
			console.log(
				`Command ${matchedCommand.command.constructor.name} completed in ${elapsed} ms`,
			);

			matchedCommand.promise.resolve(result);
			this.#pendingCommands = this.#pendingCommands.filter(
				(cmd) => cmd !== matchedCommand,
			);

            return true;
		}

        return false;
	}
}
