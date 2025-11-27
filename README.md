### websocket-js

An abstraction over WebSockets that just works. It keeps the connection alive, self-heals from failures, and provides flexibility with application-level protocol, including the client authentication mechanism.

### Installation

```bash
npm install @deilux/websocket-js
```

### Motivation
Over the past few years, I’ve had to implement WebSocket communication many times and grew tired of the repetitive boilerplate and chasing edge cases. Many WebSocket libraries were non-starters: too complex and prone to hiding the underlying protocol behind their own abstractions. Cloud-based solutions didn’t fit either — my projects require heavy customization, and at that scale I can build and operate the infrastructure myself.

This library grew out of my work on [theshutter.app](https://theshutter.app) ([@heyshutterapp](https://x.com/heyshutterapp)) — a platform for running remote photoshoots and recording video interviews — which involves a lot of real-time communication over WebSockets and WebRTC.

### AlwaysConnected

The core of this library is `AlwaysConnected` — a finite state machine that keeps a WebSocket connection alive. It handles reconnection automatically, so you don't have to.

#### State machine

```
Disconnected → Connecting → Limbo → Connected
                   ↑                    │
                   └── Reconnecting ←───┘
                         (on error, close, or heartbeat timeout)
```

- **disconnected** — initial and terminal state
- **connecting** — WebSocket is being created
- **limbo** — transport connected, waiting for application-level handshake
- **connected** — healthy connection at both transport and application level
- **reconnecting** — recovering from failure, will retry after delay

#### Application-level connection

`AlwaysConnected` is protocol-agnostic. When the WebSocket opens, it transitions to **limbo** and calls your `onConnectedFn()`. This is where you authenticate, join a room, subscribe to topics, etc. Return `true` to confirm the connection is ready, which transitions to **connected**.

If your handshake doesn't complete within `connectionTimeout`, the connection is considered failed and reconnection is triggered.

#### Heartbeats

Heartbeat handling is split by responsibility:

- **Outbound**: `AlwaysConnected` calls your `sendHeartbeat(ws, interval)` function at `heartbeatInterval`. You decide what to send (ping frame, JSON message, etc.).

- **Inbound**: Your application tracks incoming heartbeats. When you detect a missing one, call `handleWebSocketHeartbeatTimeout()` to trigger reconnection.

This design keeps `AlwaysConnected` unaware of your wire protocol.

#### WebSocket factory

`AlwaysConnected` doesn't create WebSockets directly. Instead, you provide a `createWs()` factory function. This allows you to:
- Use custom WebSocket implementations
- Add logging or instrumentation

#### Configuration

All timing is configurable via the options object:

```typescript
{
  heartbeatInterval: 15000,  // How often to send outbound heartbeats
  reconnectDelay: 2000,      // Delay before reconnection attempt
  connectionTimeout: 15000,  // Max time to complete handshake in limbo
}
```

### GreatWebSocket

`GreatWebSocket` is the main class you'll use. It wraps `AlwaysConnected` and adds:
- Convenient `send()` method with connection checking
- RPC-style request/response via `call()` and `tryHandleAsControlMessage()`
- Connection state events

#### Basic usage

```typescript
import { GreatWebSocket, ConnectionState } from '@deilux/websocket-js';

const ws = new GreatWebSocket(
  'wss://api.example.com/ws',
  
  // Called when transport connects — do your handshake here
  async () => {
    ws.send(JSON.stringify({ type: 'auth', token: 'my-token' }));
    // Return true when handshake succeeds
    return true;
  },
  
  // Called for every incoming message
  (socket, ev) => {
    const message = JSON.parse(ev.data);
    
    // First, check if it's an RPC response
    if (ws.tryHandleAsControlMessage(message)) {
      return;
    }
    
    // Otherwise, handle as a regular message
    console.log('Received:', message);
  },
  
  // Called periodically to send outbound heartbeat
  (socket, interval) => {
    socket.send(JSON.stringify({ type: 'ping' }));
  },
);

// Listen for state changes
ws.addEventListener('statechange', (ev) => {
  console.log('Connection state:', ev.state);
});

// Start the connection
ws.activate();

// Send messages (returns false if not connected)
ws.send(JSON.stringify({ type: 'hello' }));

// Stop when done
ws.shutdown();
```

#### RPC-style commands

Define commands by implementing the `RemoteCommand` interface:

```typescript
import { RemoteCommand, GreatWebSocket } from '@deilux/websocket-js';

class JoinRoomCommand implements RemoteCommand {
  private messageId = crypto.randomUUID();
  
  constructor(private roomId: string) {}
  
  execute(ws: GreatWebSocket): string {
    ws.send(JSON.stringify({
      id: this.messageId,
      type: 'join_room',
      roomId: this.roomId,
    }));
    return this.messageId;
  }
  
  responseMatches(message: unknown): boolean {
    return (message as any)?.id === this.messageId;
  }
  
  handleResponse(message: unknown): string {
    return (message as any).status; // Return whatever you need
  }
}

// Usage
const status = await ws.call(new JoinRoomCommand('room-123'));
console.log('Joined with status:', status);
```

The `call()` method returns a Promise that resolves when a matching response arrives.
