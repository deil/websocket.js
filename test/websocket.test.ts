import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionState, type heartbeatFn } from "../src/models";
import type { RemoteCommand } from "../src/rpc";

const mockCreateWebSocket = vi.fn<[], WebSocket>();

interface AlwaysConnectedStub {
  active: boolean;
  state: ConnectionState;
  websocket: WebSocket | null;
  activate: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  handleWebSocketOpen: ReturnType<typeof vi.fn>;
  handleWebSocketError: ReturnType<typeof vi.fn>;
  handleWebSocketClosed: ReturnType<typeof vi.fn>;
  handleWebSocketHeartbeatTimeout: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  __ctorArgs: {
    createWsFactory: () => WebSocket;
    onConnected: () => Promise<boolean>;
    heartbeat: heartbeatFn;
    options: {
      heartbeatInterval: number;
      reconnectDelay: number;
      connectionTimeout: number;
    };
  };
}

const alwaysConnectedInstances: AlwaysConnectedStub[] = [];

const createAlwaysConnectedStub = (
  createWsFactory: () => WebSocket,
  onConnected: () => Promise<boolean>,
  heartbeat: heartbeatFn,
  options: AlwaysConnectedStub["__ctorArgs"]["options"],
): AlwaysConnectedStub => ({
  active: false,
  state: ConnectionState.Disconnected,
  websocket: null,
  activate: vi.fn(),
  shutdown: vi.fn(),
  handleWebSocketOpen: vi.fn(),
  handleWebSocketError: vi.fn(),
  handleWebSocketClosed: vi.fn(),
  handleWebSocketHeartbeatTimeout: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  __ctorArgs: { createWsFactory, onConnected, heartbeat, options },
});

vi.mock("../src/websocket-factory", () => ({
  createWebSocket: mockCreateWebSocket,
}));

vi.mock("../src/keep-online", () => ({
  AlwaysConnected: vi.fn(
    (
      createWsFactory: () => WebSocket,
      onConnected: () => Promise<boolean>,
      heartbeat: heartbeatFn,
      options: AlwaysConnectedStub["__ctorArgs"]["options"],
    ) => {
      const instance = createAlwaysConnectedStub(
        createWsFactory,
        onConnected,
        heartbeat,
        options,
      );
      alwaysConnectedInstances.push(instance);
      return instance;
    },
  ),
}));

const getLastAlwaysConnectedInstance = () => {
  const instance = alwaysConnectedInstances.at(-1);
  if (instance == null) {
    throw new Error("No AlwaysConnected instance captured");
  }
  return instance;
};

describe("GreatWebSocket", () => {
  let GreatWebSocketClass: typeof import("../src/websocket").GreatWebSocket;
  let onConnectedFn: ReturnType<typeof vi.fn>;
  let onMessageFn: ReturnType<typeof vi.fn>;
  let sendHeartbeatFn: ReturnType<typeof vi.fn>;
  let subject: InstanceType<typeof GreatWebSocketClass>;
  let fakeSocket: WebSocket;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    alwaysConnectedInstances.length = 0;

    fakeSocket = { send: vi.fn() } as unknown as WebSocket;
    mockCreateWebSocket.mockReturnValue(fakeSocket);

    ({ GreatWebSocket: GreatWebSocketClass } = await import(
      "../src/websocket"
    ));
    onConnectedFn = vi.fn().mockResolvedValue(true);
    onMessageFn = vi.fn();
    sendHeartbeatFn = vi.fn();

    subject = new GreatWebSocketClass(
      "wss://example.test/socket",
      onConnectedFn,
      onMessageFn,
      sendHeartbeatFn,
    );
  });

  describe("constructor wiring", () => {
    it("configures AlwaysConnected with the websocket factory and options", () => {
      // Arrange
      const stub = getLastAlwaysConnectedInstance();
      const mockEvent = { data: "payload" } as MessageEvent;

      // Act
      stub.__ctorArgs.createWsFactory();
      const onMessageHandler = mockCreateWebSocket.mock.calls[0][2];
      onMessageHandler(fakeSocket, mockEvent);

      // Assert
      expect(stub.__ctorArgs.options).toEqual({
        heartbeatInterval: 15000,
        reconnectDelay: 2000,
        connectionTimeout: 15000,
      });
      expect(mockCreateWebSocket).toHaveBeenCalledWith(
        "wss://example.test/socket",
        subject,
        expect.any(Function),
      );
      expect(onMessageFn).toHaveBeenCalledWith(fakeSocket, mockEvent);
    });
  });

  describe("delegated lifecycle", () => {
    it("proxies lifecycle and event-related calls into AlwaysConnected", () => {
      // Arrange
      const stub = getLastAlwaysConnectedInstance();
      const listener = vi.fn();

      // Act
      subject.activate();
      subject.shutdown();
      subject.handleWebSocketHeartbeatTimeout();
      subject.handleWebSocketOpen();
      subject.handleWebSocketError(fakeSocket);
      subject.handleWebSocketClosed(fakeSocket);
      subject.addEventListener("statechange", listener);
      subject.removeEventListener("statechange", listener);

      // Assert
      expect(stub.activate).toHaveBeenCalledTimes(1);
      expect(stub.shutdown).toHaveBeenCalledTimes(1);
      expect(stub.handleWebSocketHeartbeatTimeout).toHaveBeenCalledTimes(1);
      expect(stub.handleWebSocketOpen).toHaveBeenCalledTimes(1);
      expect(stub.handleWebSocketError).toHaveBeenCalledWith(fakeSocket);
      expect(stub.handleWebSocketClosed).toHaveBeenCalledWith(fakeSocket);
      expect(stub.addEventListener).toHaveBeenCalledWith(
        "statechange",
        listener,
        undefined,
      );
      expect(stub.removeEventListener).toHaveBeenCalledWith(
        "statechange",
        listener,
        undefined,
      );
    });

    it("reflects active and state from AlwaysConnected", () => {
      // Arrange
      const stub = getLastAlwaysConnectedInstance();
      stub.active = true;
      stub.state = ConnectionState.Connecting;

      // Act
      const active = subject.active;
      const state = subject.state;

      // Assert
      expect(subject.active).toBe(true);
      expect(subject.state).toBe(ConnectionState.Connecting);
      expect(active).toBe(true);
      expect(state).toBe(ConnectionState.Connecting);
    });
  });

  describe("send()", () => {
    it("returns false when not connected", () => {
      // Arrange
      const stub = getLastAlwaysConnectedInstance();
      stub.state = ConnectionState.Disconnected;

      // Act
      const result = subject.send("data");

      // Assert
      expect(result).toBe(false);
      expect(fakeSocket.send).not.toHaveBeenCalled();
    });

    it("forwards payload when connected", () => {
      // Arrange
      const stub = getLastAlwaysConnectedInstance();
      const websocket = { send: vi.fn() } as unknown as WebSocket;
      stub.state = ConnectionState.Connected;
      stub.websocket = websocket;

      // Act
      const result = subject.send("hello");

      // Assert
      expect(result).toBe(true);
      expect(websocket.send).toHaveBeenCalledWith("hello");
    });
  });

  describe("RPC handling", () => {
    it("executes commands and resolves when a matching response arrives", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const command: RemoteCommand = {
        execute: vi.fn().mockReturnValue("rpc-1"),
        responseMatches: vi.fn().mockReturnValue(true),
        handleResponse: vi.fn().mockReturnValue({ ok: true }),
      };
      const callPromise = subject.call(command);
      const message = { id: "rpc-1" };

      // Act
      const firstHandleResult = subject.tryHandleAsControlMessage(message);
      await callPromise;
      const secondHandleResult = subject.tryHandleAsControlMessage(message);

      // Assert
      expect(command.execute).toHaveBeenCalledWith(subject);
      expect(firstHandleResult).toBe(true);
      await expect(callPromise).resolves.toEqual({ ok: true });
      expect(command.responseMatches).toHaveBeenCalledWith(message);
      expect(command.handleResponse).toHaveBeenCalledWith(message);
      expect(secondHandleResult).toBe(false);

      consoleSpy.mockRestore();
    });

    it("returns false for non-matching messages", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const command: RemoteCommand = {
        execute: vi.fn().mockReturnValue("rpc-2"),
        responseMatches: vi
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        handleResponse: vi.fn().mockReturnValue("done"),
      };
      const callPromise = subject.call(command);
      const firstMessage = { id: "ignored" };
      const matchingMessage = { id: "rpc-2" };

      // Act
      const firstResult = subject.tryHandleAsControlMessage(firstMessage);
      const secondResult = subject.tryHandleAsControlMessage(matchingMessage);
      await callPromise;

      // Assert
      expect(firstResult).toBe(false);
      expect(secondResult).toBe(true);
      await expect(callPromise).resolves.toBe("done");

      consoleSpy.mockRestore();
    });
  });
});
