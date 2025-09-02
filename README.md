### websocket-js

An abstraction over WebSockets that just works. It keeps the connection alive, self-heals from failures, and provides flexibility about the authentication mechanism and the application-level protocol itself.

### Status
work-in-progress; install locally via `npm link`

### Motivation
Over the past few years, I’ve had to implement WebSocket communication many times and grew tired of the repetitive boilerplate and chasing edge cases. Many WebSocket libraries were non-starters: too complex and prone to hiding the underlying protocol behind their own abstractions. Cloud-based solutions didn’t fit either—my projects require heavy customization, and at that scale I can build and operate the infrastructure myself.

This library grew out of my work on [theshutter.app](https://theshutter.app) ([@heyshutterapp](https://x.com/heyshutterapp)) — a platform for running remote photoshoots and recording video interviews — which involves a lot of real-time communication over WebSockets and WebRTC.

### Connection model
At its core, this is a finite state machine around the WebSocket lifecycle and its health.

- **disconnected** — initial and terminal state
- **connecting** — initial connection attempt
- **reconnecting** — reconnection after a failure (network error, heartbeat timeout)
- **limbo** — established transport-level connection, but application-level not yet
- **connected** — desired state of the connection; healthy at both transport-level and application-level

When the connection reaches the limbo state, it triggers a hook to the client code, so that the application can initialize the connection — for example, authenticate, join a room, subscribe to a topic, etc.

At configurable intervals, the socket sends an outbound heartbeat, and also monitors for inbound ones; if a heartbeat hasn’t been received during a timeout, the connection is marked as unhealthy and reconnection is triggered.

### Roadmap
- Fully encapsulate WebSocket management
- Support for RPC-style calls
