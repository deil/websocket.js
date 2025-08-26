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
	statechange: ConnectionStateChangeEvent;
	connectiontimeout: Event;
}

export class ConnectionStateChangeEvent extends Event {
	#state: ConnectionState;

	constructor(state: ConnectionState) {
		super("statechange");
		this.#state = state;
	}

	get state() {
		return this.#state;
	}
}

export class GreatWebSocket extends EventTarget {
	private readonly CONNECTION_TIMEOUT = 15000;
	private readonly RECONNECT_DELAY = 5000;
	private readonly HEARTBEAT_INTERVAL = 15000;

	#active = false;
	#state = ConnectionState.Disconnected;
	#connectionWatchdog: number | null = null;
	#heartbeatTimeout: number | null = null;
	#pendingCommands: PendingCommand[] = [];

	constructor(
		private readonly ws: IWebSocket,
		private readonly onConnectedFn: () => Promise<boolean>,
	) {
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

		this.#heartbeatTimeout = setInterval(() => {
			if (!this.active || !this.ws.isConnected()) {
				return;
			}

			this.ws.heartbeat();
		}, this.HEARTBEAT_INTERVAL);

		this.ws.reconnect();
	}

	shutdown() {
		if (this.#heartbeatTimeout != null) {
			clearInterval(this.#heartbeatTimeout);
			this.#heartbeatTimeout = null;
		}

		this.stopConnectionWatchdog();
		this.#active = false;
	}

	transitionToState(state: ConnectionState) {
		if (this.#state === state) {
			return;
		}

		this.#state = state;

		if (this.#state === ConnectionState.Limbo) {
			this.startConnectionWatchdog();
		} else if (this.#state === ConnectionState.Connected) {
			this.stopConnectionWatchdog();
		}

		this.dispatchEvent(new ConnectionStateChangeEvent(state));
	}

	handleWebSocketOpen() {
		this.transitionToState(ConnectionState.Limbo);

		this.onConnectedFn().then((success) => {
			if (success) {
				this.transitionToState(ConnectionState.Connected);
			}
		});
	}

	handleWebSocketError() {
		this.reconnectIfNeeded();
	}

	handleWebSocketClosed() {
		this.reconnectIfNeeded();
	}

	handleWebSocketHeartbeatTimeout() {
		this.reconnectIfNeeded();
	}

	handleMessageReceived(ws: WebSocket, ev: MessageEvent) {
		this.ws.onMessage(ev);
	}

	startConnectionWatchdog() {
		this.#connectionWatchdog = setTimeout(() => {
			this.dispatchEvent(new Event("connectiontimeout"));
			this.reconnectIfNeeded();
		}, this.CONNECTION_TIMEOUT);
	}

	stopConnectionWatchdog() {
		if (this.#connectionWatchdog != null) {
			clearTimeout(this.#connectionWatchdog);
			this.#connectionWatchdog = null;
		}
	}

	reconnectIfNeeded() {
		/*
		if (eventTarget !== this.#ws) {
	      return;
    	}
		*/

		if (!this.active) {
			this.transitionToState(ConnectionState.Disconnected);
			return;
		}

		this.transitionToState(ConnectionState.Reconnecting);
		this.stopConnectionWatchdog();
		this.ws.close();

		setTimeout(() => {
			if (!this.active || this.ws.isConnected()) {
				return;
			}

			this.ws.reconnect();
		}, this.RECONNECT_DELAY);
	}

	//#region Events

	addEventListener<K extends keyof GreatWebSocketEventMap>(
		type: K,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void {
		super.addEventListener(type, listener, options);
	}

	removeEventListener<K extends keyof GreatWebSocketEventMap>(
		type: K,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	): void {
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
