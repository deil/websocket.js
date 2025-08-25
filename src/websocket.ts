import { ConnectionState, type IWebSocket, type RemoteCommand } from "./models";

interface PendingCommand {
	command: RemoteCommand;
	executedAt: number;
	rpcId?: string;
	promise: {
		resolve: (result: unknown) => void;
		reject: (error: unknown) => void;
	};
}

export interface GreatWebSocketEventMap {
    "statechange": ConnectionStateChangeEvent;
}

export class ConnectionStateChangeEvent extends Event {
	#state: ConnectionState;

	constructor(state: ConnectionState) {
		super('statechange');
		this.#state = state;
	}

	get state() {
		return this.#state;
	}
}

export class GreatWebSocket extends EventTarget {
	#active = false;
	#state = ConnectionState.Disconnected;
	#pendingCommands: PendingCommand[] = [];

	constructor(private readonly ws: IWebSocket) {
		super();
	}

	get active() {
		return this.#active;
	}

	get state() {
		return this.#state;
	}

	activate() {
		this.#active = true;
	}

	shutdown() {
		this.#active = false;
	}

	transitionToState(state: ConnectionState) {
		if (this.#state === state) {
			return;
		}

		this.#state = state;
		this.dispatchEvent(new ConnectionStateChangeEvent(state));
	}

	//#region Events

	addEventListener<K extends keyof GreatWebSocketEventMap>(type: K, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
		super.addEventListener(type, listener, options);
	}

	removeEventListener<K extends keyof GreatWebSocketEventMap>(type: K, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
		super.removeEventListener(type, listener, options);
	}

	//#endregion

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
