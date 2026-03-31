# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Philosophy

**Disconnect** is an intentional MSN-style messaging app where "online means present." No offline messaging, no queued messages, no background notifications. If a recipient is offline, the message is rejected immediately — this is a core feature, not a bug.

## Development Commands

### Backend (`cd backend`)
```bash
npm run dev          # Start dev server with hot reload (port 3001)
npm run build        # Compile TypeScript
npm run prisma:migrate  # Run DB migrations
npm run prisma:studio   # Visual DB browser at :5555
npm run db:push      # Quick schema sync (dev only)
npm run db:seed      # Seed test data
```

### Frontend (`cd frontend`)
```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Type-check + bundle
npm run lint         # ESLint
```

### Services (must be running)
```bash
brew services start postgresql@17
brew services start redis
```

No automated tests yet — keeping iteration speed high. Backend endpoints are manually tested with curl; see `README.md` for examples. When adding new endpoints, add curl examples to README at the same time.

## Before Committing

Before every commit, review the work done in that session and ask: *has anything non-obvious been discovered that future Claude instances should know?* If yes, update CLAUDE.md before committing. Report what you added (or why you added nothing) — don't silently skip this step.

Good candidates: gotchas uncovered by a bug, coupling between two subsystems, constraints not visible from the code alone, patterns that are easy to misunderstand.
Bad candidates: anything derivable by reading the code, git history, or existing documentation.

## Architecture

### Backend (`backend/src/`)
- **`index.ts`** — Express + HTTP server, mounts routes, initializes WebSocketService, starts listening
- **`routes/`** — auth, friends, messages (all list endpoints wrap arrays in an object key — see API Shapes below)
- **`middleware/authenticate.ts`** — JWT validation, attaches `req.user`
- **`services/websocket.ts`** — WebSocketService class, manages `userId → WebSocket` map, heartbeats, message routing
- **`services/wsInstance.ts`** — Singleton getter/setter so route handlers can call `sendToUser` without circular deps
- **`services/presence.ts`** — Redis-backed presence (online/away/offline computed from `lastSeen` timestamp)
- **`prisma/schema.prisma`** — PostgreSQL schema via Prisma ORM

### Frontend (`frontend/src/`)
- **`contexts/AuthContext.tsx`** — JWT + current user, persisted in localStorage, validates token on load via `GET /api/auth/me`
- **`contexts/WSContext.tsx`** — Central WS state: friends, messages, presence, pending friend requests, connection lifecycle
- **`lib/api.ts`** — REST client; all response shapes are unwrapped before returning (see API Shapes)
- **`types/index.ts`** — Shared TypeScript types including the `WSMessage` discriminated union
- **`pages/`** — Login, Register, Main (three-panel layout when chat open, expanded contact list otherwise)
- **`components/`** — ContactList, TabStrip, ChatWindow, AddFriendModal, PendingRequests

### Provider tree
```
<AuthContext>
  <WSContext>       ← connects WS only when token exists
    <Router>
      <Main>        ← reads friends/messages from WSContext
```

## WebSocket

**URL:** `ws://localhost:3001/ws?token=<jwt>` (path is `/ws`, auth via query param)

**Client → Server:** `heartbeat`, `message`

**Server → Client:** `connected`, `message_received`, `message_sent`, `message_failed`, `presence_change`, `friend_accepted`, `friend_request_received`, `heartbeat_ack`, `force_logout`

### StrictMode double-mount pattern (do not change without reading both sides)
The frontend uses an `active` flag in the WS `useEffect`. On cleanup, if the socket is still `CONNECTING`, it overrides `ws.onopen = () => ws.close()` instead of calling `ws.close()` directly. This avoids Chrome's "WebSocket closed before connection established" warning.

This works because the backend `handleDisconnect` checks `this.connections.get(ws.userId) !== ws` before doing anything — if a newer connection replaced the old one, the stale disconnect is ignored. **Both sides are coupled. Don't change one without the other.**

## API Response Shapes

Every list endpoint wraps its array — always unwrap in `api.ts`:
- `GET /api/auth/me` → `{ user: User }`
- `GET /api/friends` → `{ friends: Friend[] }`
- `GET /api/friends/requests/pending` → `{ requests: FriendRequest[] }`
- `GET /api/messages/conversation/:id` → `{ messages: Message[] }`
- Validation errors use express-validator format: `{ errors: [{msg, path}] }` not `{ error: string }`

**Always read the backend route handler before writing frontend API calls.** Assuming shapes has caused multiple integration bugs.

## Prisma Friendship Model Gotcha

```
friendship.user   → follows userId FK   → the REQUEST SENDER
friendship.friend → follows friendId FK → the REQUEST RECEIVER
```
These are easily confused. Always double-check which side you need when querying or returning friendship data.

## Key Non-Obvious Patterns

**Message deduplication:** When opening a chat, REST history is merged with any real-time WS messages already in memory. `seedConversation()` in WSContext deduplicates by message ID and sorts by `sentAt`.

**One connection per user:** A new WS connection replaces the old one in the `connections` map. The disconnect guard on the backend prevents the old connection's cleanup from wiping the active user's presence.

**Presence is ephemeral:** Redis only, cleared on server restart. Status is computed from `lastSeen`: 0–30 s → online, 30–90 s → away, 90 s+ → offline. (Thresholds are reduced for testing — production values were 5/15 min.) `PresenceService.clearAll()` runs on startup inside a try/catch so a Redis hiccup at boot doesn't crash the server.

**Active presence monitoring — `startPresenceMonitor()`:** Called once from `initialize()`. Runs a `setInterval` every 10 seconds that iterates all live connections, calls `PresenceService.getPresence(userId)` to read the computed status from Redis, and compares it to `ws.presenceStatus` (the last state friends were notified about). If the status changed, it fires the appropriate transition:
- `ONLINE → AWAY`: logs, notifies friends via `notifyFriendsPresenceChange`.
- `AWAY → OFFLINE` (or `ONLINE → OFFLINE`): sends `{ type: 'force_logout', reason: 'inactivity' }` to the client, removes the connection from the map (so `handleDisconnect` won't double-fire), closes the socket, then notifies friends.
The `presenceStatus` field on `AuthenticatedWebSocket` is initialized to `ONLINE` on connect and kept in sync by the monitor and the heartbeat handler — it exists solely to suppress duplicate broadcasts when nothing has changed.

**Heartbeat restores AWAY → ONLINE:** When the heartbeat handler receives a `heartbeat` from the client, it updates `lastSeen` in Redis. If `ws.presenceStatus` is currently `AWAY`, it immediately resets it to `ONLINE` and fires `notifyFriendsPresenceChange` — so a user who wakes up from idle snaps back to online without waiting for the next monitor tick.

**Activity-aware heartbeat (frontend):** WSContext tracks real user activity (`mousemove`, `keydown`, `click`) via `lastActivityRef`. The heartbeat interval fires every 15 s but only sends a heartbeat to the server if the user was active in the last 15 s. If the user is idle, the heartbeat is skipped — allowing the backend's presence monitor to detect inactivity and transition the user to away/offline. Without this, the heartbeat alone would keep resetting `lastSeen` and the away/offline states would never trigger.

**`force_logout` handling (frontend):** WSContext handles `{ type: 'force_logout' }` by calling `logout()` from AuthContext, which clears the JWT and redirects to login. This is the only server-initiated session termination path.

**`pendingCount` / `pendingSeen` in WSContext:** Lives in WSContext (not ContactList) so the WS message handler can increment it when a `friend_request_received` event arrives.

**ContactItem defined outside ContactList:** Moving it inside causes React to remount all contact items on every parent re-render (e.g. every presence update). Keep it outside.

**ChatWindow keyed by friend ID:** `<ChatWindow key={activeFriend.id} />` in Main.tsx — ensures the component fully remounts (resets scroll, input, history fetch) when switching conversations.

## Frontend Layout: Tabbed Chat

`Main.tsx` manages two pieces of state: `openTabIds: string[]` (which chats are open, in order) and `activeTabId: string | null` (which is currently focused). The layout has three states:

| State | ContactList | TabStrip | ChatWindow |
|---|---|---|---|
| No open tabs | `flex-1` — fills screen | hidden | hidden |
| Tabs open, none active | `flex-1` — fills remaining space | visible | hidden |
| Tabs open, one active | `w-52` sidebar | visible | `flex-1` |

`ContactList` receives `fullscreen={activeTabId === null}` — it expands whenever no chat is active, regardless of whether tabs exist. `TabStrip` (`components/TabStrip.tsx`) renders `null` when `openTabIds` is empty.

**Closing a tab always sets `activeTabId` to `null`** — the user must explicitly click a tab to reopen a chat. No auto-selection of the next tab.

**Opening a chat** (clicking a contact) adds it to `openTabIds` if not already present, then sets it as active. Clicking a contact whose tab is already open just switches to it without duplicating.

**Tab strip** sits between ContactList and ChatWindow — a 40px wide vertical column of square boxes showing contact initials. Active tab has a left blue border + white background. Close button (×) appears on hover.

**Unread tab state:** `unreadIds: Set<string>` lives in `Main.tsx`. When a `message_received` WS event arrives for a sender who is not the active chat, their tab is opened (if not already), marked unread, and a notification sound plays. Unread tabs render with an amber background + small amber dot. The unread state clears when the user switches to, opens from the contact list, or closes that tab.

**`lastIncoming` in WSContext:** Set on every `message_received` event. `Main.tsx` watches it with a `useEffect` to drive tab-open and unread logic. An `activeTabIdRef` (kept in sync via a separate effect) lets the incoming-message effect read the current active tab without adding `activeTabId` as a dependency — otherwise the effect would re-run on every tab switch, not just on new messages.

**Notification sound:** `lib/sound.ts` generates a two-tone sine wave (660 Hz → 880 Hz) via Web Audio API. No audio asset required.

**Redis startup race — wrap early presence calls in try/catch:** `redisClient.connect()` in `utils/redis.ts` is fire-and-forget (no `await`). There is a window between process start and the connection being established. Any code that runs Redis operations immediately on startup — like `PresenceService.clearAll()` inside `WebSocketService.initializeAsync()` — can throw `"The client is closed"`. Those calls must be wrapped in try/catch so a Redis hiccup doesn't crash the server.

**Unhandled rejections crash Node.js ≥15:** In Node.js ≥15 an unhandled Promise rejection terminates the process (`process.exit(1)`). TypeScript constructors cannot be `async`, so async startup work (e.g. `this.initializeAsync()` in `WebSocketService`) is fire-and-forget from the constructor's perspective — the constructor can't `.catch()` it and the caller can't `await` it. Always wrap the body of such methods in try/catch. If the process dies mid-response, the client gets an empty body and `"Unexpected end of JSON input"` — even if the failing code has nothing to do with that HTTP route.
