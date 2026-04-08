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

Before every commit, review the work done in that session and ask: *has anything non-obvious been discovered that future Claude instances should know?* If yes, update the appropriate CLAUDE.md (root, `backend/CLAUDE.md`, or `frontend/CLAUDE.md`) before committing. Report what you added (or why you added nothing) — don't silently skip this step.

Good candidates: gotchas uncovered by a bug, coupling between two subsystems, constraints not visible from the code alone, patterns that are easy to misunderstand.
Bad candidates: anything derivable by reading the code, git history, or existing documentation.

Also update `README.md` if the commit changes anything a developer would need to know: new endpoints (add to the API table + curl example), new environment variables, new npm scripts, changed project structure, new debugging tools, or new troubleshooting scenarios. README.md is the human developer manual — keep it current.

If you encounter edge cases, known limitations, or improvement ideas that are deferred (not blocking the current work), add them to `FUTURE.md` rather than leaving them undocumented.

## Architecture

### Backend (`backend/src/`)
- **`index.ts`** — Express + HTTP server, mounts routes, initializes WebSocketService
- **`routes/`** — auth, friends, messages, avatar
- **`middleware/auth.ts`** — JWT validation, attaches `req.user`
- **`services/websocket.ts`** — WebSocketService: `userId → Set<WebSocket>` (multi-tab), heartbeats, message routing
- **`services/wsInstance.ts`** — Singleton getter/setter so route handlers can call `sendToUser` without circular deps
- **`services/presence.ts`** — Redis-backed presence (online/away/offline from `lastSeen`)
- **`services/tokenBlocklist.ts`** — Redis-backed JWT blocklist with auto-expiring TTL
- **`routes/avatar.ts`** — Avatar upload (multer, 2MB, images only), saves to `uploads/avatars/`
- **`prisma/schema.prisma`** — PostgreSQL schema via Prisma ORM

### Frontend (`frontend/src/`)
- **`contexts/AuthContext.tsx`** — JWT + current user, persisted in localStorage
- **`contexts/WSContext.tsx`** — Central WS state: friends, messages, presence, pending requests, connection lifecycle
- **`lib/api.ts`** — REST client; response shapes unwrapped before returning
- **`lib/sound.ts`** — Web Audio API notification sounds
- **`types/index.ts`** — Shared TypeScript types including `WSMessage` discriminated union
- **`pages/`** — Login, Register, Main (three-panel layout)
- **`components/`** — ContactList, TabStrip, ChatWindow, Avatar, AvatarUpload, ToastContainer, AddFriendModal, PendingRequests

### Provider tree
```
<AuthContext>
  <WSContext>       ← connects WS only when token exists
    <Router>
      <Main>        ← reads friends/messages from WSContext
```

## WebSocket Protocol

**URL:** `ws://localhost:3001/ws?token=<jwt>` (path is `/ws`, auth via query param)

**Client → Server:** `heartbeat`, `message` (includes `clientId` for optimistic matching)

**Server → Client:** `connected`, `message_received`, `message_sent` (echoes `clientId`), `message_failed` (echoes `clientId`), `message_delivered` (messageId + deliveredAt), `message_read` (messageId + readAt), `presence_change` (includes `notify` flag), `friend_accepted`, `friend_request_received`, `heartbeat_ack`, `force_logout`

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

## Detailed Documentation

For detailed patterns, gotchas, and non-obvious behaviors, see:
- **`backend/CLAUDE.md`** — WS connection lifecycle, presence system, token blocklist, Redis patterns
- **`frontend/CLAUDE.md`** — WS effect patterns, tabbed chat layout, optimistic messages, toasts, session styling
