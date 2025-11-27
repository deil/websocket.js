### websocket-js

An abstraction over WebSockets that just works. It keeps the connection alive, self-heals from failures, and provides flexibility with application-level protocol, including the client authentication mechanism.

### Status
work-in-progress; install locally via `npm link`

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

### Roadmap
- Fully encapsulate WebSocket management
- Support for RPC-style calls
