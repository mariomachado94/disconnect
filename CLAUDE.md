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
- **`pages/`** — Login, Register, Main (two-panel layout)
- **`components/`** — ContactList, ChatWindow, AddFriendModal, PendingRequests

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

**Server → Client:** `connected`, `message_received`, `message_sent`, `message_failed`, `presence_change`, `friend_accepted`, `friend_request_received`, `heartbeat_ack`

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

**Presence is ephemeral:** Redis only, cleared on server restart. Status is computed from `lastSeen`: 0-5 min → online, 5-15 min → away, 15+ min → offline. `PresenceService.clearAll()` runs on startup.

**`pendingCount` / `pendingSeen` in WSContext:** Lives in WSContext (not ContactList) so the WS message handler can increment it when a `friend_request_received` event arrives.

**ContactItem defined outside ContactList:** Moving it inside causes React to remount all contact items on every parent re-render (e.g. every presence update). Keep it outside.

**ChatWindow keyed by friend ID:** `<ChatWindow key={selectedFriend.id} />` in Main.tsx — ensures the component fully remounts when switching conversations.
