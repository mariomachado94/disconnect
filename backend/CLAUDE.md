# Backend — Detailed Patterns

This file documents non-obvious backend behaviors. For architecture overview, commands, and API shapes, see the root `CLAUDE.md`.

## WS Connection Lifecycle — Zombie Prevention

**Early event handler registration:** The `connection` handler registers `ws.on('close', ...)` BEFORE any `await` (like `isBlocklisted()`). This is critical because if the socket closes during an async yield and the close handler isn't registered yet, the event is lost and the socket becomes a zombie in the connection set — never removed, blocking presence transitions forever. The `ws.established` flag (set after `addConnection`) ensures `handleDisconnect` ignores close events for sockets that closed before they were fully set up (e.g. rejected by the blocklist check).

**Post-await `readyState` check prevents a second class of zombie.** Even with early handler registration, StrictMode can still create ghosts: WS1 connects → close handler registered → `await isBlocklisted()` yields → StrictMode cleanup closes WS1 → `handleDisconnect` fires but `established` is false so it's ignored → await resumes → `addConnection` adds the dead socket. The fix: check `ws.readyState !== WebSocket.OPEN` after all awaits, before `addConnection`. If the socket died during the async gap, bail out instead of adding it.

## Multiple Connections Per User (Multi-Tab)

`connections` is `Map<string, Set<AuthenticatedWebSocket>>`. Each browser tab gets its own socket in the set. Presence transitions only happen on first-connect (set goes 0 → 1) and last-disconnect (set goes 1 → 0). Closing one of three tabs just removes that socket from the set — no presence change, no grace timer. Message delivery and `sendToUser` broadcast to all sockets in the set so every tab stays in sync.

## Presence System

**Presence is ephemeral:** Redis only, cleared on server restart. Status is computed from `lastSeen`: 0–60 s → online, 60–120 s → away, 120 s+ → offline. Thresholds live in `AWAY_TIMEOUT` / `LOGOUT_TIMEOUT` constants at the top of `presence.ts`. **The frontend mirrors the away threshold** (`60_000` in `WSContext.tsx`) to drive the local away overlay — if you change `AWAY_TIMEOUT` here, update the frontend constant too, or the overlay will fire at the wrong time. `PresenceService.clearAll()` runs on startup inside a try/catch so a Redis hiccup at boot doesn't crash the server.

**Active presence monitoring — `startPresenceMonitor()`:** Called once from `initialize()`. Runs a `setInterval` every 1 second that iterates unique userIds in the connections map, calls `PresenceService.getPresence(userId)` to read the computed status from Redis, and compares it to `ws.presenceStatus` on the first socket (all sockets for a user share the same logical state). If the status changed, it updates `presenceStatus` on ALL sockets for that user and fires the appropriate transition:
- `ONLINE → AWAY`: logs, notifies friends via `notifyFriendsPresenceChange`.
- `AWAY → OFFLINE` (or `ONLINE → OFFLINE`): sends `{ type: 'force_logout', reason: 'inactivity' }` to ALL of the user's connections, blocklists each token, closes all sockets, removes the user from the map (so `handleDisconnect` won't double-fire), then notifies friends.

The `presenceStatus` field on `AuthenticatedWebSocket` is initialized to `ONLINE` on connect and kept in sync by the monitor and the heartbeat handler — it exists solely to suppress duplicate broadcasts when nothing has changed.

**Heartbeat restores AWAY → ONLINE:** When the heartbeat handler receives a `heartbeat` from the client, it updates `lastSeen` in Redis. If `ws.presenceStatus` is currently `AWAY`, it resets `presenceStatus` to `ONLINE` on ALL of the user's sockets (not just the one that sent the heartbeat) and fires `notifyFriendsPresenceChange` — so a user who wakes up from idle snaps back to online without waiting for the next monitor tick. Updating all sockets is important: if only the active socket is updated, the monitor may read a stale `AWAY` from a sibling socket and fire a redundant notification or skip updates.

## ONLINE Notification Timing

**`notifiedOnline` set + `onlineNotifyTimers`:** When a user's first connection arrives (set goes 0 → 1), the ONLINE notification is NOT sent immediately. Instead, a 300ms `onlineNotifyTimers` timer is scheduled. This lets React StrictMode's ephemeral mount/unmount/remount settle. When the timer fires, it checks two things: (a) the user is still connected, and (b) `notifiedOnline` does not already contain this user (meaning friends haven't already been told). If both pass, it sends `presence_change(ONLINE, notify: true)` and adds the user to `notifiedOnline`. On page refresh, `notifiedOnline` still has the user (it's only cleared when OFFLINE fires), so the notification is correctly suppressed. On `handleDisconnect` (last tab), any pending notify timer is cancelled — the user disconnected before the 300ms stabilization window elapsed.

## Disconnect Grace Period (5 s)

When the *last* connection for a user closes, `handleDisconnect` does NOT mark them offline immediately. Instead it starts a 5-second `disconnectGraceTimers` timer. If the user reconnects within that window (page refresh, network blip), the grace timer is cancelled — friends never see an offline/online flap. If the timer expires without reconnect, `notifiedOnline.delete(userId)` + `setOffline` + `notifyFriendsPresenceChange(OFFLINE)` fires. Clearing `notifiedOnline` means the next login will correctly trigger a fresh ONLINE notification. The 90-second token blocklist timer starts independently on disconnect (it doesn't wait for the grace period). 5s was chosen to absorb page refreshes from high-latency connections (e.g. Southeast Asia → North America) where page reload + WS handshake can exceed 1s.

## Token Blocklist

**Disconnect-based token blocklist:** When a user's WebSocket disconnects, `handleDisconnect` starts a 90-second timer (`forceReloginTimers`). If the user reconnects within 90s, the timer is cancelled in the connection handler. If not, the JWT is added to a Redis blocklist (`TokenBlocklist.blocklist()`) with a TTL equal to the token's remaining lifetime. The auth middleware and WS connection handler both check `TokenBlocklist.isBlocklisted()` — a blocklisted token returns 401 / closes the socket. This means closing the browser for >90s requires re-login. Network blips and page refreshes (sub-second reconnects) are unaffected. The `forceReloginTimers` map is in-memory; lost on server restart, which is acceptable since all WS connections are also dropped.

**JWT expiry is 1 day** (not 7). With the 120s inactivity force-logout, a 7-day token was oversized. 1 day limits blocklist storage and reduces exposure if a token is stolen. Blocklist TTL is derived from the token's `exp` claim, so entries self-clean.

## Delivery/Read Receipt Pipeline

When a message is delivered to the recipient's WS connections, the backend sets `deliveredAt` and sends `message_delivered` (with `messageId`) back to the sender's connections. When the recipient opens a chat (or receives messages while the chat is open), `POST /api/messages/read/:friendId` fires, which sets `readAt` on all unread messages and sends `message_read` (with the last `messageId`) to the sender. The `message_read` event carries a specific message ID — the frontend marks that message and all earlier sent messages as read. This avoids a race condition where a message sent just before the read event would be incorrectly marked as read.

**Message delivery/read are timestamps, not booleans:** `deliveredAt` and `readAt` are nullable `DateTime` fields. `null` means "not yet delivered/read"; a non-null value is the timestamp when it happened.

## Avatar Upload and Serving

Avatars are uploaded via `POST /api/avatar` (multer, 2MB, images only) and stored on disk at `backend/uploads/avatars/{userId}.{ext}`. Served via `express.static` at `/uploads/...`. The `avatarUrl` field on User stores the relative path (e.g. `/uploads/avatars/abc.png`).

## 24-Hour Message Retention in API

The `GET /api/messages/conversation/:friendId` endpoint only returns messages from the last 24 hours (`sentAt >= now - 24h`). Messages older than that exist in the database but are never sent to the client. This is a deliberate design choice aligned with Disconnect's ephemeral philosophy. If a "show full history" setting is added later, the filter lives in one place: `routes/messages.ts`.

## Node.js / Redis Gotchas

**Redis startup race — wrap early presence calls in try/catch:** `redisClient.connect()` in `utils/redis.ts` is fire-and-forget (no `await`). There is a window between process start and the connection being established. Any code that runs Redis operations immediately on startup — like `PresenceService.clearAll()` inside `WebSocketService.initializeAsync()` — can throw `"The client is closed"`. Those calls must be wrapped in try/catch so a Redis hiccup doesn't crash the server.

**Unhandled rejections crash Node.js ≥15:** In Node.js ≥15 an unhandled Promise rejection terminates the process (`process.exit(1)`). TypeScript constructors cannot be `async`, so async startup work (e.g. `this.initializeAsync()` in `WebSocketService`) is fire-and-forget from the constructor's perspective — the constructor can't `.catch()` it and the caller can't `await` it. Always wrap the body of such methods in try/catch. If the process dies mid-response, the client gets an empty body and `"Unexpected end of JSON input"` — even if the failing code has nothing to do with that HTTP route.
