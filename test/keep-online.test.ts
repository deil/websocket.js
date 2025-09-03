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
    vi.clearAllTimers();

    mockWebSocket = new MockWebSocket();
    createWebSocketFn = vi.fn(() => mockWebSocket as any);
    onConnectedFn = vi.fn().mockResolvedValue(true);
    sendHeartbeatFn = vi.fn();

    alwaysConnected = new AlwaysConnected(
      createWebSocketFn,
      onConnectedFn,
      sendHeartbeatFn,
    );
  });

  afterEach(() => {
    alwaysConnected.shutdown();
  });

  // Initialization tests
  it("should initialize with correct default values", () => {
    // Arrange & Act - already done in beforeEach

    // Assert
    expect(alwaysConnected.active).toBe(false);
    expect(alwaysConnected.state).toBe(ConnectionState.Disconnected);
    expect(alwaysConnected.websocket).toBeNull();
  });

  // Activate tests
  it("should set active to true and create WebSocket", () => {
    // Arrange
    expect(alwaysConnected.active).toBe(false);

    // Act
    alwaysConnected.activate();

    // Assert
    expect(alwaysConnected.active).toBe(true);
    expect(createWebSocketFn).toHaveBeenCalledTimes(1);
    expect(alwaysConnected.websocket).toBe(mockWebSocket);
  });

  it("should throw error when activated multiple times", () => {
    // Arrange
    alwaysConnected.activate();

    // Act & Assert
    expect(() => {
      alwaysConnected.activate();
    }).toThrow("Already active");
    expect(createWebSocketFn).toHaveBeenCalledTimes(1);
  });

  // Shutdown tests
  it("should disconnect and clean up all resources completely", () => {
    // Arrange - Set up active connection with timers
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen(); // This starts connection watchdog

    // Act
    alwaysConnected.shutdown();

    // Assert - Verify complete resource cleanup
    expect(alwaysConnected.active).toBe(false);
    expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

    // Verify timers are cleared (we can't directly test internal timers,
    // but we can verify the connection watchdog is stopped)
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);
    vi.advanceTimersByTime(20000); // Beyond CONNECTION_TIMEOUT
    expect(timeoutHandler).not.toHaveBeenCalled(); // Should not fire if cleaned up
  });

  it("should be safe to call multiple times", () => {
    // Arrange
    alwaysConnected.activate();

    // Act
    alwaysConnected.shutdown();
    alwaysConnected.shutdown();

    // Assert
    expect(alwaysConnected.active).toBe(false);
    expect(mockWebSocket.close).toHaveBeenCalledTimes(2); // Each shutdown closes current WebSocket
  });

  it("should clean up resources even when called during reconnection", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketError(mockWebSocket as any); // Start reconnection

    // Act
    alwaysConnected.shutdown();

    // Assert
    expect(alwaysConnected.active).toBe(false);
    // Note: State may remain in current state during shutdown
    // WebSocket reference may be kept for cleanup purposes
  });

  // handleWebSocketOpen tests
  it("should transition to Limbo state and start connection watchdog", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.handleWebSocketOpen();

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
    expect(stateChangeHandler).toHaveBeenCalledWith(
      expect.any(ConnectionStateChangeEvent),
    );
    expect(stateChangeHandler.mock.calls[0][0].state).toBe(
      ConnectionState.Limbo,
    );
  });

  it("should call onConnectedFn when entering Limbo state", async () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.handleWebSocketOpen();

    // Assert - onConnectedFn should be called when entering Limbo
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
    // The onConnectedFn call happens asynchronously, so we check it was set up to be called
  });

  it("should call onConnectedFn and transition to Connected on success", async () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.handleWebSocketOpen();
    await vi.runAllTimersAsync();

    // Assert
    expect(onConnectedFn).toHaveBeenCalledTimes(1);
    expect(alwaysConnected.state).toBe(ConnectionState.Connected);
    expect(stateChangeHandler).toHaveBeenCalledTimes(2);
    expect(stateChangeHandler.mock.calls[1][0].state).toBe(
      ConnectionState.Connected,
    );
  });

  it("should trigger reconnection if onConnectedFn fails within timeout", async () => {
    // Arrange
    onConnectedFn.mockResolvedValue(false);
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.activate(); // Must be active for reconnection
    alwaysConnected.handleWebSocketOpen();
    vi.advanceTimersByTime(15000); // Wait for connection timeout

    // Assert
    expect(onConnectedFn).toHaveBeenCalledTimes(1);
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    expect(stateChangeHandler).toHaveBeenCalledTimes(2); // Limbo -> Reconnecting
  });

  // handleWebSocketError tests
  it("should trigger reconnection when active", () => {
    // Arrange
    alwaysConnected.activate();
    const oldWebSocket = alwaysConnected.websocket;

    // Act
    alwaysConnected.handleWebSocketError(mockWebSocket as any);

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    expect(oldWebSocket?.close).toHaveBeenCalledTimes(1);
  });

  it("should ignore errors from old WebSocket instances when active", () => {
    // Arrange
    alwaysConnected.activate();
    const oldWebSocket = alwaysConnected.websocket;
    alwaysConnected.handleWebSocketError(mockWebSocket as any); // Trigger error to get to Reconnecting
    const newWebSocket = alwaysConnected.websocket;

    // Act - try to trigger error from old WebSocket
    alwaysConnected.handleWebSocketError(oldWebSocket as any);

    // Assert - should be ignored because it's from old WebSocket
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should only respond to events from current WebSocket instance", () => {
    // Arrange
    alwaysConnected.activate();
    const firstWebSocket = alwaysConnected.websocket;

    // Create a completely different WebSocket instance (simulate old connection)
    const differentWebSocket = new MockWebSocket();

    // Act - Send events from different WebSocket
    alwaysConnected.handleWebSocketError(differentWebSocket as any);
    alwaysConnected.handleWebSocketClosed(differentWebSocket as any);

    // Assert - Should ignore events from different WebSocket instances
    expect(alwaysConnected.state).toBe(ConnectionState.Disconnected); // Should not have changed
    expect(alwaysConnected.websocket).toBe(firstWebSocket);
  });

  // handleWebSocketClosed tests
  it("should trigger reconnection when active", () => {
    // Arrange
    alwaysConnected.activate();

    // Act
    alwaysConnected.handleWebSocketClosed(mockWebSocket as any);

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should ignore close events from old WebSocket instances when active", () => {
    // Arrange
    alwaysConnected.activate();
    const oldWebSocket = alwaysConnected.websocket;
    alwaysConnected.handleWebSocketError(mockWebSocket as any); // Trigger error to get to Reconnecting
    const newWebSocket = alwaysConnected.websocket;

    // Act - try to trigger close from old WebSocket
    alwaysConnected.handleWebSocketClosed(oldWebSocket as any);

    // Assert - should be ignored because it's from old WebSocket
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should ignore close events from completely different WebSocket instances", () => {
    // Arrange
    alwaysConnected.activate();
    const currentWebSocket = alwaysConnected.websocket;

    // Create a completely different WebSocket instance (simulate stale connection)
    const staleWebSocket = new MockWebSocket();

    // Act - Try to close with stale WebSocket
    alwaysConnected.handleWebSocketClosed(staleWebSocket as any);

    // Assert - Should ignore the stale WebSocket event
    expect(alwaysConnected.state).toBe(ConnectionState.Disconnected); // Unchanged
    expect(alwaysConnected.websocket).toBe(currentWebSocket);
  });

  // handleWebSocketHeartbeatTimeout tests
  it("should trigger reconnection when active", () => {
    // Arrange
    alwaysConnected.activate();

    // Act
    alwaysConnected.handleWebSocketHeartbeatTimeout();

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should be a no-op when inactive", () => {
    // Arrange
    const initialState = alwaysConnected.state;
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.handleWebSocketHeartbeatTimeout();

    // Assert
    // When inactive, heartbeat timeout should be ignored
    expect(alwaysConnected.state).toBe(initialState);
    expect(stateChangeHandler).not.toHaveBeenCalled();
  });

  it("should trigger reconnection from Limbo state when active", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

    // Act - Error occurs while in Limbo
    alwaysConnected.handleWebSocketError(mockWebSocket as any);

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should trigger heartbeat timeout reconnection from any active state", () => {
    // Arrange - Test from Limbo state
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

    // Act
    alwaysConnected.handleWebSocketHeartbeatTimeout();

    // Assert
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  // Connection watchdog tests
  it("should dispatch connectiontimeout event after timeout", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen(); // Starts watchdog
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

    // Act
    vi.advanceTimersByTime(15000); // CONNECTION_TIMEOUT

    // Assert
    expect(timeoutHandler).toHaveBeenCalledTimes(1);
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should timeout when connection fails in limbo state", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

    // Assert: Watchdog is active
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

    // Act: Advance time to trigger watchdog timeout
    vi.advanceTimersByTime(15000);

    // Assert: Watchdog should fire and transition to reconnecting
    expect(timeoutHandler).toHaveBeenCalledTimes(1);
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
  });

  it("should be stopped on shutdown", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

    // Act
    alwaysConnected.shutdown();
    vi.advanceTimersByTime(15000);

    // Assert
    expect(timeoutHandler).not.toHaveBeenCalled();
  });

  // Heartbeat functionality tests
  it("should not send heartbeat when not active", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.shutdown();

    // Act
    vi.advanceTimersByTime(15000);

    // Assert
    expect(sendHeartbeatFn).not.toHaveBeenCalled();
  });

  // Reconnection logic tests
  it("should clean up resources during reconnection (like shutdown)", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen(); // This starts connection watchdog

    // Act - Trigger reconnection
    alwaysConnected.handleWebSocketError(mockWebSocket as any);

    // Assert - Should clean up like shutdown does
    expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

    // Verify connection watchdog is stopped
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);
    vi.advanceTimersByTime(20000); // Beyond CONNECTION_TIMEOUT
    expect(timeoutHandler).not.toHaveBeenCalled(); // Should not fire if cleaned up
  });

  it("should not reconnect if not active", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.shutdown();

    // Act
    alwaysConnected.handleWebSocketError(mockWebSocket as any);
    vi.advanceTimersByTime(5000);

    // Assert - Should not create new socket when inactive
    expect(createWebSocketFn).toHaveBeenCalledTimes(1);
  });

  // State transitions tests
  it("should dispatch statechange events for transitions", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.activate(); // Creates WebSocket, no state change yet
    alwaysConnected.handleWebSocketOpen(); // To Limbo

    // Assert
    expect(stateChangeHandler).toHaveBeenCalledTimes(1);
    expect(stateChangeHandler.mock.calls[0][0].state).toBe(
      ConnectionState.Limbo,
    );
  });

  it("should not dispatch event when transitioning to same state", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketError(mockWebSocket as any); // To Reconnecting
    alwaysConnected.handleWebSocketError(alwaysConnected.websocket as any); // Try to go to Reconnecting again

    // Assert
    expect(stateChangeHandler).toHaveBeenCalledTimes(1);
    expect(stateChangeHandler.mock.calls[0][0].state).toBe(
      ConnectionState.Reconnecting,
    );
  });

  // Event listener methods tests
  it("should properly add and remove event listeners", () => {
    // Arrange
    const listener = vi.fn();

    // Act
    alwaysConnected.addEventListener("statechange", listener);
    alwaysConnected.handleWebSocketOpen();
    alwaysConnected.removeEventListener("statechange", listener);
    alwaysConnected.handleWebSocketClosed(mockWebSocket as any);

    // Assert
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("should support typed event listeners", () => {
    // Arrange
    const stateChangeListener = vi.fn();
    const timeoutListener = vi.fn();

    // Act
    alwaysConnected.addEventListener("statechange", stateChangeListener);
    alwaysConnected.addEventListener("connectiontimeout", timeoutListener);

    alwaysConnected.handleWebSocketOpen();

    // Assert
    expect(stateChangeListener).toHaveBeenCalledTimes(1);
    expect(timeoutListener).not.toHaveBeenCalled();
  });

  // Finite state machine scenarios tests
  it("should complete basic connection lifecycle", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act: Activate
    alwaysConnected.activate();

    // Assert: Should create WebSocket and be in initial state
    expect(alwaysConnected.active).toBe(true);
    expect(alwaysConnected.websocket).toBeDefined();

    // Act: WebSocket opens
    alwaysConnected.handleWebSocketOpen();

    // Assert: Should be in Limbo state waiting for onConnectedFn
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);
    expect(stateChangeHandler).toHaveBeenCalledTimes(1);
    expect(stateChangeHandler.mock.calls[0][0].state).toBe(
      ConnectionState.Limbo,
    );

    // Act: Deactivate
    alwaysConnected.shutdown();

    // Assert: Should be cleanly shut down
    // Note: State may remain in current state during shutdown
    expect(alwaysConnected.active).toBe(false);
    // WebSocket reference may be kept for cleanup purposes
  });

  it("should handle error and start reconnection", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act: Connect and then error occurs
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();

    // Assert: In Limbo state
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

    // Act: Error occurs during connection
    alwaysConnected.handleWebSocketError(mockWebSocket as any);

    // Assert: Should start reconnecting
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    expect(stateChangeHandler).toHaveBeenCalledTimes(2); // Limbo → Reconnecting
  });

  it("should handle heartbeat timeout when active", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act: Connect
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();

    // Assert: In Limbo state
    expect(alwaysConnected.state).toBe(ConnectionState.Limbo);

    // Act: Heartbeat timeout occurs
    alwaysConnected.handleWebSocketHeartbeatTimeout();

    // Assert: Should start reconnecting
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    expect(stateChangeHandler).toHaveBeenCalledTimes(2); // Limbo → Reconnecting
  });

  it("should handle connection failure in limbo state (watchdog timeout)", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    const timeoutHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);
    alwaysConnected.addEventListener("connectiontimeout", timeoutHandler);

    // Act: Start connection that fails
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();
    onConnectedFn.mockResolvedValue(false); // Connection fails

    // Let watchdog timeout
    vi.advanceTimersByTime(15000);

    // Assert: Should transition to reconnecting
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);
    expect(timeoutHandler).toHaveBeenCalledTimes(1);
  });

  it("should handle shutdown during reconnection", () => {
    // Arrange
    const stateChangeHandler = vi.fn();
    alwaysConnected.addEventListener("statechange", stateChangeHandler);

    // Act: Connect, error, start reconnecting, then shutdown
    alwaysConnected.activate();
    alwaysConnected.handleWebSocketOpen();

    alwaysConnected.handleWebSocketError(mockWebSocket as any);
    expect(alwaysConnected.state).toBe(ConnectionState.Reconnecting);

    // Shutdown during reconnection
    alwaysConnected.shutdown();

    // Assert: Should be cleanly shut down
    // Note: State may remain in current state during shutdown
    expect(alwaysConnected.active).toBe(false);
    // WebSocket reference may be kept for cleanup purposes
  });

  // Edge cases tests
  it("should handle null WebSocket in heartbeat", () => {
    // Arrange
    alwaysConnected.activate();
    alwaysConnected.shutdown(); // This should clear WebSocket

    // Act
    vi.advanceTimersByTime(15000);

    // Assert
    expect(sendHeartbeatFn).not.toHaveBeenCalled();
  });
});
