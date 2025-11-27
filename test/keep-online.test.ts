import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionStateChangeEvent } from "../src/events";
import { AlwaysConnected } from "../src/keep-online";
import { ConnectionState } from "../src/models";

// Mock implementations
class MockWebSocket {
  public readyState = 1; // OPEN
  public close = vi.fn();
  public send = vi.fn();
  public addEventListener = vi.fn();
  public removeEventListener = vi.fn();
}

describe("AlwaysConnected", () => {
  let mockWebSocket: MockWebSocket;
  let createWebSocketFn: vi.MockedFunction<() => WebSocket>;
  let onConnectedFn: vi.MockedFunction<() => Promise<boolean>>;
  let sendHeartbeatFn: vi.MockedFunction<(ws: WebSocket) => void>;
  let alwaysConnected: AlwaysConnected;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.clearAllTimers();

    mockWebSocket = new MockWebSocket();
    createWebSocketFn = vi.fn(() => mockWebSocket as any);
    onConnectedFn = vi.fn().mockResolvedValue(true);
    sendHeartbeatFn = vi.fn();

    alwaysConnected = new AlwaysConnected(
      createWebSocketFn,
      onConnectedFn,
      sendHeartbeatFn,
      { heartbeatInterval: 15000, reconnectDelay: 5000, connectionTimeout: 15000 },
    );
  });

  afterEach(() => {
    alwaysConnected.shutdown();
    vi.useRealTimers();
  });

  const waitForPendingConnection = async () => {
    const lastIndex = onConnectedFn.mock.results.length - 1;
    const connectPromise = onConnectedFn.mock.results[lastIndex]
      ?.value as Promise<boolean> | undefined;

    if (connectPromise == null) {
      throw new Error("onConnectedFn did not return a promise");
    }

    await connectPromise;
    await Promise.resolve();
  };

  const activateAndEnterLimbo = () => {
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
  };

  const activateAndConnect = async () => {
    activateAndEnterLimbo();
    await waitForPendingConnection();
  };

  describe("initialization", () => {
    it("starts inactive and disconnected", () => {
      expect(alwaysConnected.active).toBe(false);
      expect(alwaysConnected.state).toBe(ConnectionState.Disconnected);
      expect(alwaysConnected.websocket).toBeNull();
    });
  });

  describe("activate()", () => {
    it("creates a websocket and marks the operator as active", () => {
      expect(alwaysConnected.active).toBe(false);

      alwaysConnected.activate();

      expect(alwaysConnected.active).toBe(true);
      expect(createWebSocketFn).toHaveBeenCalledTimes(1);
      expect(alwaysConnected.websocket).toBe(mockWebSocket);
    });

    it("throws when called twice", () => {
      alwaysConnected.activate();

      expect(() => alwaysConnected.activate()).toThrow("Already active");
      expect(createWebSocketFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("shutdown()", () => {
    it("fully cleans up active resources", () => {
      activateAndEnterLimbo();

      alwaysConnected.shutdown();

      expect(alwaysConnected.active).toBe(false);
      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);
      vi.advanceTimersByTime(20000);
      expect(timeoutHandler).not.toHaveBeenCalled();
    });

    it("can be called repeatedly", () => {
      alwaysConnected.activate();

      alwaysConnected.shutdown();
      alwaysConnected.shutdown();

      expect(alwaysConnected.active).toBe(false);
      expect(mockWebSocket.close).toHaveBeenCalledTimes(2);
    });

    it("cleans up when invoked during reconnection", () => {
      alwaysConnected.activate();
      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      alwaysConnected.shutdown();

      expect(alwaysConnected.active).toBe(false);
    });

    it("allows a fresh activation afterwards", async () => {
      activateAndEnterLimbo();
      await Promise.resolve();
      alwaysConnected.shutdown();

      alwaysConnected.activate();

      expect(alwaysConnected.active).toBe(true);
      expect(alwaysConnected.state).toBe(ConnectionState.Connecting);
      expect(createWebSocketFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleWebSocketOpen()", () => {
    it("moves into Limbo and emits a state change", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.handleWebSocketOpen();

      expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
      expect(stateChangeHandler).toHaveBeenCalledWith(
        expect.any(ConnectionStateChangeEvent),
      );
      expect(stateChangeHandler.mock.calls[0][0].state).toBe(
        ConnectionState.Limbo,
      );
    });

    it("starts the onConnected handshake", () => {
      alwaysConnected.handleWebSocketOpen();

      expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
      expect(onConnectedFn).toHaveBeenCalledTimes(1);
    });

    it("transitions to Connected once the handshake succeeds", async () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.handleWebSocketOpen();
      await waitForPendingConnection();

      expect(onConnectedFn).toHaveBeenCalledTimes(1);
      expect(alwaysConnected.state).toBe(ConnectionState.Connected);
      expect(stateChangeHandler).toHaveBeenCalledTimes(2);
      expect(stateChangeHandler.mock.calls[1][0].state).toBe(
        ConnectionState.Connected,
      );
    });

    it("falls back to Reconnecting when the handshake fails", () => {
      onConnectedFn.mockResolvedValue(false);
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      activateAndEnterLimbo();
      vi.advanceTimersByTime(15000);

      expect(onConnectedFn).toHaveBeenCalledTimes(1);
      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(stateChangeHandler).toHaveBeenCalledTimes(3);
    });

    it("ignores stale onConnected resolutions once a reconnect starts", async () => {
      let resolveConnected!: (value: boolean) => void;
      onConnectedFn.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveConnected = resolve;
          }),
      );

      activateAndEnterLimbo();
      const pendingPromise = onConnectedFn.mock.results[0]?.value as
        | Promise<boolean>
        | undefined;

      if (pendingPromise == null) {
        throw new Error("Missing connection promise");
      }

      if (typeof resolveConnected !== "function") {
        throw new Error("Missing connection resolver");
      }

      alwaysConnected.handleWebSocketError(mockWebSocket as any);
      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);

      resolveConnected(true);
      await pendingPromise;
      await Promise.resolve();

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });
  });

  describe("handleWebSocketError()", () => {
    it("reconnects the current socket when active", () => {
      alwaysConnected.activate();
      const oldWebSocket = alwaysConnected.websocket;

      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(oldWebSocket?.close).toHaveBeenCalledTimes(1);
    });

    it("ignores errors from stale sockets", () => {
      alwaysConnected.activate();
      const oldWebSocket = alwaysConnected.websocket;
      alwaysConnected.handleWebSocketError(mockWebSocket as any);
      const newWebSocket = alwaysConnected.websocket;

      alwaysConnected.handleWebSocketError(oldWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(newWebSocket).not.toBe(oldWebSocket);
    });

    it("ignores completely different WebSocket instances", () => {
      alwaysConnected.activate();
      const firstWebSocket = alwaysConnected.websocket;
      const differentWebSocket = new MockWebSocket();

      alwaysConnected.handleWebSocketError(differentWebSocket as any);
      alwaysConnected.handleWebSocketClosed(differentWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Connecting);
      expect(alwaysConnected.websocket).toBe(firstWebSocket);
    });

    it("forces reconnection even when already in Limbo", () => {
      activateAndEnterLimbo();

      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });
  });

  describe("handleWebSocketClosed()", () => {
    it("reconnects when the current socket closes", () => {
      alwaysConnected.activate();

      alwaysConnected.handleWebSocketClosed(mockWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });

    it("ignores close events from stale sockets", () => {
      alwaysConnected.activate();
      const oldWebSocket = alwaysConnected.websocket;
      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      alwaysConnected.handleWebSocketClosed(oldWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });

    it("ignores close events from unrelated sockets", () => {
      alwaysConnected.activate();
      const currentWebSocket = alwaysConnected.websocket;
      const staleWebSocket = new MockWebSocket();

      alwaysConnected.handleWebSocketClosed(staleWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Connecting);
      expect(alwaysConnected.websocket).toBe(currentWebSocket);
    });
  });

  describe("handleWebSocketHeartbeatTimeout()", () => {
    it("initiates reconnection when active", () => {
      alwaysConnected.activate();

      alwaysConnected.handleWebSocketHeartbeatTimeout();

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });

    it("is a no-op when inactive", () => {
      const initialState = alwaysConnected.state;
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.handleWebSocketHeartbeatTimeout();

      expect(alwaysConnected.state).toBe(initialState);
      expect(stateChangeHandler).not.toHaveBeenCalled();
    });

    it("reconnects from any active state (Limbo scenario)", () => {
      activateAndEnterLimbo();

      alwaysConnected.handleWebSocketHeartbeatTimeout();

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });
  });

  describe("connection watchdog", () => {
    it("dispatches connectiontimeout after the deadline", () => {
      activateAndEnterLimbo();
      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

      vi.advanceTimersByTime(15000);

      expect(timeoutHandler).toHaveBeenCalledTimes(1);
      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });

    it("times out if Limbo never resolves", () => {
      activateAndEnterLimbo();
      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

      vi.advanceTimersByTime(15000);

      expect(timeoutHandler).toHaveBeenCalledTimes(1);
      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    });

    it("stops once shutdown runs", () => {
      activateAndEnterLimbo();
      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

      alwaysConnected.shutdown();
      vi.advanceTimersByTime(15000);

      expect(timeoutHandler).not.toHaveBeenCalled();
    });
  });

  describe("heartbeat scheduling", () => {
    it("does not send heartbeats when inactive", () => {
      alwaysConnected.activate();
      alwaysConnected.shutdown();

      vi.advanceTimersByTime(15000);

      expect(sendHeartbeatFn).not.toHaveBeenCalled();
    });

    it("sends heartbeats when connected", async () => {
      await activateAndConnect();

      vi.advanceTimersByTime(15000);

      expect(sendHeartbeatFn).toHaveBeenCalledTimes(1);
      expect(sendHeartbeatFn).toHaveBeenCalledWith(mockWebSocket, 15000);
    });

    it("skips heartbeats when the socket reference is null", () => {
      alwaysConnected.activate();
      alwaysConnected.shutdown();

      vi.advanceTimersByTime(15000);

      expect(sendHeartbeatFn).not.toHaveBeenCalled();
    });
  });

  describe("reconnection scheduling", () => {
    it("cleans up like shutdown before scheduling reconnect", () => {
      activateAndEnterLimbo();

      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);
      vi.advanceTimersByTime(20000);
      expect(timeoutHandler).not.toHaveBeenCalled();
    });

    it("skips creating a new socket when one already exists", () => {
      const secondMockWs = new MockWebSocket();
      createWebSocketFn
        .mockReturnValueOnce(mockWebSocket as any)
        .mockReturnValueOnce(secondMockWs as any);

      alwaysConnected.activate();
      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      vi.advanceTimersByTime(1000);
      alwaysConnected.handleWebSocketHeartbeatTimeout();

      vi.advanceTimersByTime(4000);
      expect(createWebSocketFn).toHaveBeenCalledTimes(2);
      expect(alwaysConnected.websocket).toBe(secondMockWs);

      vi.advanceTimersByTime(5000);

      expect(createWebSocketFn).toHaveBeenCalledTimes(2);
    });

    it("does not reconnect while inactive", () => {
      alwaysConnected.activate();
      alwaysConnected.shutdown();

      alwaysConnected.handleWebSocketError(mockWebSocket as any);
      vi.advanceTimersByTime(5000);

      expect(createWebSocketFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("state change events", () => {
    it("emits events for real transitions only", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.activate();
      alwaysConnected.handleWebSocketOpen();

      expect(stateChangeHandler).toHaveBeenCalledTimes(2);
      expect(stateChangeHandler.mock.calls[0][0].state).toBe(
        ConnectionState.Connecting,
      );
      expect(stateChangeHandler.mock.calls[1][0].state).toBe(
        ConnectionState.Limbo,
      );
    });

    it("suppresses duplicate transition events", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.activate();
      alwaysConnected.handleWebSocketError(mockWebSocket as any);
      alwaysConnected.handleWebSocketError(alwaysConnected.websocket as any);

      expect(stateChangeHandler).toHaveBeenCalledTimes(2);
      expect(stateChangeHandler.mock.calls[0][0].state).toBe(
        ConnectionState.Connecting,
      );
      expect(stateChangeHandler.mock.calls[1][0].state).toBe(
        ConnectionState.Reconnecting,
      );
    });
  });

  describe("EventTarget integration", () => {
    it("registers and removes listeners", () => {
      const listener = vi.fn();

      alwaysConnected.addEventListener("statechange", listener);
      alwaysConnected.handleWebSocketOpen();
      alwaysConnected.removeEventListener("statechange", listener);
      alwaysConnected.handleWebSocketClosed(mockWebSocket as any);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("supports typed listeners", () => {
      const stateChangeListener = vi.fn();
      const timeoutListener = vi.fn();

      alwaysConnected.addEventListener("statechange", stateChangeListener);
      alwaysConnected.addEventListener("connectiontimeout", timeoutListener);

      alwaysConnected.handleWebSocketOpen();

      expect(stateChangeListener).toHaveBeenCalledTimes(1);
      expect(timeoutListener).not.toHaveBeenCalled();
    });
  });

  describe("integration scenarios", () => {
    it("runs through the basic lifecycle", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      alwaysConnected.activate();
      expect(alwaysConnected.active).toBe(true);
      expect(alwaysConnected.websocket).toBeDefined();

      alwaysConnected.handleWebSocketOpen();
      expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
      expect(stateChangeHandler).toHaveBeenCalledTimes(2);
      expect(stateChangeHandler.mock.calls[1][0].state).toBe(
        ConnectionState.Limbo,
      );

      alwaysConnected.shutdown();
      expect(alwaysConnected.active).toBe(false);
    });

    it("handles errors by starting reconnection", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      activateAndEnterLimbo();
      expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

      alwaysConnected.handleWebSocketError(mockWebSocket as any);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(stateChangeHandler).toHaveBeenCalledTimes(3);
    });

    it("handles heartbeat timeouts while active", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      activateAndEnterLimbo();
      expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

      alwaysConnected.handleWebSocketHeartbeatTimeout();

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(stateChangeHandler).toHaveBeenCalledTimes(3);
    });

    it("handles watchdog timeouts while in Limbo", () => {
      const stateChangeHandler = vi.fn();
      const timeoutHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);
      alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

      activateAndEnterLimbo();
      onConnectedFn.mockResolvedValue(false);
      vi.advanceTimersByTime(15000);

      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
      expect(timeoutHandler).toHaveBeenCalledTimes(1);
    });

    it("can shut down safely during reconnection", () => {
      const stateChangeHandler = vi.fn();
      alwaysConnected.addEventListener("statechange", stateChangeHandler);

      activateAndEnterLimbo();
      alwaysConnected.handleWebSocketError(mockWebSocket as any);
      expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);

      alwaysConnected.shutdown();

      expect(alwaysConnected.active).toBe(false);
    });
  });
});
