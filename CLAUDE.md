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
