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

### Debug & Testing
```bash
DEBUG_WS=1 npm run dev   # Verbose WebSocket lifecycle logs (connect/disconnect/timers/monitor)
node test-presence.js    # Manual WS presence scenario runner (needs ALICE_TOKEN + BOB_TOKEN env vars)
```

## Before Committing

Before every commit, review the work done in that session and ask: *has anything non-obvious been discovered that future Claude instances should know?* If yes, update CLAUDE.md before committing. Report what you added (or why you added nothing) — don't silently skip this step.

Good candidates: gotchas uncovered by a bug, coupling between two subsystems, constraints not visible from the code alone, patterns that are easy to misunderstand.
Bad candidates: anything derivable by reading the code, git history, or existing documentation.

Also update `README.md` if the commit changes anything a developer would need to know: new endpoints (add to the API table + curl example), new environment variables, new npm scripts, changed project structure, new debugging tools, or new troubleshooting scenarios. README.md is the human developer manual — keep it current.

## Architecture

### Backend (`backend/src/`)
- **`index.ts`** — Express + HTTP server, mounts routes, initializes WebSocketService, starts listening
- **`routes/`** — auth, friends, messages, avatar (all list endpoints wrap arrays in an object key — see API Shapes below)
- **`middleware/auth.ts`** — JWT validation, attaches `req.user`
- **`services/websocket.ts`** — WebSocketService class, manages `userId → Set<WebSocket>` (multi-tab), heartbeats, message routing
- **`services/wsInstance.ts`** — Singleton getter/setter so route handlers can call `sendToUser` without circular deps
- **`services/presence.ts`** — Redis-backed presence (online/away/offline computed from `lastSeen` timestamp)
- **`services/tokenBlocklist.ts`** — Redis-backed JWT blocklist with auto-expiring TTL; used by auth middleware and WS connect
- **`routes/avatar.ts`** — Avatar upload endpoint (multer, 2MB limit, images only), saves to `uploads/avatars/`
- **`prisma/schema.prisma`** — PostgreSQL schema via Prisma ORM

### Frontend (`frontend/src/`)
- **`contexts/AuthContext.tsx`** — JWT + current user, persisted in localStorage, validates token on load via `GET /api/auth/me`
- **`contexts/WSContext.tsx`** — Central WS state: friends, messages, presence, pending friend requests, connection lifecycle
- **`lib/api.ts`** — REST client; all response shapes are unwrapped before returning (see API Shapes)
- **`lib/sound.ts`** — Web Audio API notification sounds: `playNotification()` (message chirp), `playFriendOnline()` (warm chime)
- **`types/index.ts`** — Shared TypeScript types including the `WSMessage` discriminated union
- **`components/ToastContainer.tsx`** — Fixed-position toast stack (top-right, `right-14` to clear TabStrip)
- **`pages/`** — Login, Register, Main (three-panel layout when chat open, expanded contact list otherwise)
- **`components/Avatar.tsx`** — Shared avatar component (image or initials fallback), used by ContactList, TabStrip, ChatWindow
- **`components/AvatarUpload.tsx`** — Modal for uploading avatar, triggered from ContactList header
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

**Server → Client:** `connected`, `message_received`, `message_sent`, `message_failed`, `presence_change` (includes `notify` flag), `friend_accepted`, `friend_request_received`, `heartbeat_ack`, `force_logout`

### StrictMode double-mount pattern
The frontend uses an `active` flag in the WS `useEffect`. On cleanup, if the socket is still `CONNECTING`, it overrides `ws.onopen = () => ws.close()` instead of calling `ws.close()` directly. This avoids Chrome's "WebSocket closed before connection established" warning.

**Backend: early event handler registration prevents zombie connections.** The `connection` handler registers `ws.on('close', ...)` BEFORE any `await` (like `isBlocklisted()`). This is critical because if the socket closes during an async yield and the close handler isn't registered yet, the event is lost and the socket becomes a zombie in the connection set — never removed, blocking presence transitions forever. The `ws.established` flag (set after `addConnection`) ensures `handleDisconnect` ignores close events for sockets that closed before they were fully set up (e.g. rejected by the blocklist check).

**Post-await `readyState` check prevents a second class of zombie.** Even with early handler registration, StrictMode can still create ghosts: WS1 connects → close handler registered → `await isBlocklisted()` yields → StrictMode cleanup closes WS1 → `handleDisconnect` fires but `established` is false so it's ignored → await resumes → `addConnection` adds the dead socket. The fix: check `ws.readyState !== WebSocket.OPEN` after all awaits, before `addConnection`. If the socket died during the async gap, bail out instead of adding it.

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

**Multiple connections per user (multi-tab):** `connections` is `Map<string, Set<AuthenticatedWebSocket>>`. Each browser tab gets its own socket in the set. Presence transitions only happen on first-connect (set goes 0 → 1) and last-disconnect (set goes 1 → 0). Closing one of three tabs just removes that socket from the set — no presence change, no grace timer. Message delivery and `sendToUser` broadcast to all sockets in the set so every tab stays in sync.

**ONLINE notification: `notifiedOnline` set + `onlineNotifyTimers`:** When a user's first connection arrives (set goes 0 → 1), the ONLINE notification is NOT sent immediately. Instead, a 300ms `onlineNotifyTimers` timer is scheduled. This lets React StrictMode's ephemeral mount/unmount/remount settle. When the timer fires, it checks two things: (a) the user is still connected, and (b) `notifiedOnline` does not already contain this user (meaning friends haven't already been told). If both pass, it sends `presence_change(ONLINE, notify: true)` and adds the user to `notifiedOnline`. On page refresh, `notifiedOnline` still has the user (it's only cleared when OFFLINE fires), so the notification is correctly suppressed. On `handleDisconnect` (last tab), any pending notify timer is cancelled — the user disconnected before the 300ms stabilization window elapsed.

**Disconnect grace period (1 s):** When the *last* connection for a user closes, `handleDisconnect` does NOT mark them offline immediately. Instead it starts a 1-second `disconnectGraceTimers` timer. If the user reconnects within that window (page refresh, network blip), the grace timer is cancelled — friends never see an offline/online flap. If the timer expires without reconnect, `notifiedOnline.delete(userId)` + `setOffline` + `notifyFriendsPresenceChange(OFFLINE)` fires. Clearing `notifiedOnline` means the next login will correctly trigger a fresh ONLINE notification. The 90-second token blocklist timer starts independently on disconnect (it doesn't wait for the grace period).

**Presence is ephemeral:** Redis only, cleared on server restart. Status is computed from `lastSeen`: 0–30 s → online, 30–90 s → away, 90 s+ → offline. (Thresholds are reduced for testing — production values were 5/15 min.) `PresenceService.clearAll()` runs on startup inside a try/catch so a Redis hiccup at boot doesn't crash the server.

**Active presence monitoring — `startPresenceMonitor()`:** Called once from `initialize()`. Runs a `setInterval` every 1 second that iterates unique userIds in the connections map, calls `PresenceService.getPresence(userId)` to read the computed status from Redis, and compares it to `ws.presenceStatus` on the first socket (all sockets for a user share the same logical state). If the status changed, it updates `presenceStatus` on ALL sockets for that user and fires the appropriate transition:
- `ONLINE → AWAY`: logs, notifies friends via `notifyFriendsPresenceChange`.
- `AWAY → OFFLINE` (or `ONLINE → OFFLINE`): sends `{ type: 'force_logout', reason: 'inactivity' }` to ALL of the user's connections, blocklists each token, closes all sockets, removes the user from the map (so `handleDisconnect` won't double-fire), then notifies friends.
The `presenceStatus` field on `AuthenticatedWebSocket` is initialized to `ONLINE` on connect and kept in sync by the monitor and the heartbeat handler — it exists solely to suppress duplicate broadcasts when nothing has changed.

**Heartbeat restores AWAY → ONLINE:** When the heartbeat handler receives a `heartbeat` from the client, it updates `lastSeen` in Redis. If `ws.presenceStatus` is currently `AWAY`, it resets `presenceStatus` to `ONLINE` on ALL of the user's sockets (not just the one that sent the heartbeat) and fires `notifyFriendsPresenceChange` — so a user who wakes up from idle snaps back to online without waiting for the next monitor tick. Updating all sockets is important: if only the active socket is updated, the monitor may read a stale `AWAY` from a sibling socket and fire a redundant notification or skip updates.

**Activity-aware heartbeat (frontend):** WSContext tracks real user activity (`mousemove`, `keydown`, `click`) via `lastActivityRef`. The heartbeat interval fires every 2 s but only sends a heartbeat to the server if the user was active in the last 2 s. If the user is idle, the heartbeat is skipped — allowing the backend's presence monitor to detect inactivity and transition the user to away/offline. Without this, the heartbeat alone would keep resetting `lastSeen` and the away/offline states would never trigger.

**Disconnect-based token blocklist:** When a user's WebSocket disconnects, `handleDisconnect` starts a 90-second timer (`forceReloginTimers`). If the user reconnects within 90s, the timer is cancelled in the connection handler. If not, the JWT is added to a Redis blocklist (`TokenBlocklist.blocklist()`) with a TTL equal to the token's remaining lifetime. The auth middleware and WS connection handler both check `TokenBlocklist.isBlocklisted()` — a blocklisted token returns 401 / closes the socket. This means closing the browser for >90s requires re-login. Network blips and page refreshes (sub-second reconnects) are unaffected. The `forceReloginTimers` map is in-memory; lost on server restart, which is acceptable since all WS connections are also dropped.

**JWT expiry is 1 day** (not 7). With the 90s disconnect/inactivity force-logout, a 7-day token was oversized. 1 day limits blocklist storage and reduces exposure if a token is stolen. Blocklist TTL is derived from the token's `exp` claim, so entries self-clean.

**`force_logout` handling (frontend):** WSContext handles `{ type: 'force_logout' }` by calling `logout()` from AuthContext, which clears the JWT and redirects to login. This is the only server-initiated session termination path.

**`pendingCount` / `pendingSeen` in WSContext:** Lives in WSContext (not ContactList) so the WS message handler can increment it when a `friend_request_received` event arrives.

**Message delivery/read are timestamps, not booleans:** `deliveredAt` and `readAt` are nullable `DateTime` fields. `null` means "not yet delivered/read"; a non-null value is the timestamp when it happened. The old `delivered: true/false` and `read: true/false` booleans no longer exist.

**Avatar upload and serving:** Avatars are uploaded via `POST /api/avatar` (multer, 2MB, images only) and stored on disk at `backend/uploads/avatars/{userId}.{ext}`. Served via `express.static` at `/uploads/...`. The `avatarUrl` field on User stores the relative path (e.g. `/uploads/avatars/abc.png`). Frontend prefixes with `VITE_API_URL` when rendering. The `Avatar` component handles the image-or-initials fallback logic — always use it instead of inline initials.

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

**Tab strip** sits between ContactList and ChatWindow — a 60px wide vertical column of square boxes showing avatars (or initials fallback). Active tab has a right blue border + white background. Close button (×) appears on hover.

**Unread tab state:** `unreadIds: Set<string>` lives in `Main.tsx`. When a `message_received` WS event arrives for a sender who is not the active chat, their tab is opened (if not already), marked unread, and a notification sound plays. Unread tabs render with an amber background + small amber dot. The unread state clears when the user switches to, opens from the contact list, or closes that tab.

**`lastIncoming` in WSContext:** Set on every `message_received` event. `Main.tsx` watches it with a `useEffect` to drive tab-open and unread logic. An `activeTabIdRef` (kept in sync via a separate effect) lets the incoming-message effect read the current active tab without adding `activeTabId` as a dependency — otherwise the effect would re-run on every tab switch, not just on new messages.

**Notification sounds:** `lib/sound.ts` generates sounds via Web Audio API (no audio assets). `playNotification()` is a sharp sine chirp (660 → 880 Hz) for messages. `playFriendOnline()` is a softer triangle-wave chime (C5 → E5, 523 → 659 Hz) for friends coming online.

**Toast notifications:** `ToastContainer` renders a fixed-position stack in the top-right corner (`right-14` / 56px margin to always clear the 40px TabStrip). Toasts slide in from the right, fade out after 3.5s, and are removed from DOM at 3.8s. Two kinds: `friend-online` (green dot + "is now online") and `new-message` (blue dot + "New message from"). Toast state and the `addToast` helper live in `Main.tsx`. The `toastIdCounter` is a module-level variable (not state) to avoid stale closures in setTimeout callbacks.

**`presence_change` notify flag:** Every `presence_change` WS event includes a `notify: boolean` field. The backend sets `notify: true` only for genuine offline → online transitions (first connection, not a grace-period reconnect). All other transitions (away → online, status updates) send `notify: false`. WSContext always updates the friends list for any presence_change, but only sets `lastPresenceChange` (which triggers toast/sound in Main.tsx) when `notify` is true. This keeps the "should we notify?" decision entirely on the backend, where all the context lives.

**Redis startup race — wrap early presence calls in try/catch:** `redisClient.connect()` in `utils/redis.ts` is fire-and-forget (no `await`). There is a window between process start and the connection being established. Any code that runs Redis operations immediately on startup — like `PresenceService.clearAll()` inside `WebSocketService.initializeAsync()` — can throw `"The client is closed"`. Those calls must be wrapped in try/catch so a Redis hiccup doesn't crash the server.

**Unhandled rejections crash Node.js ≥15:** In Node.js ≥15 an unhandled Promise rejection terminates the process (`process.exit(1)`). TypeScript constructors cannot be `async`, so async startup work (e.g. `this.initializeAsync()` in `WebSocketService`) is fire-and-forget from the constructor's perspective — the constructor can't `.catch()` it and the caller can't `await` it. Always wrap the body of such methods in try/catch. If the process dies mid-response, the client gets an empty body and `"Unexpected end of JSON input"` — even if the failing code has nothing to do with that HTTP route.
