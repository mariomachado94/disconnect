# Disconnect - Project Context

## What We're Building
Intentional messaging app where "online means present" - inspired by MSN Messenger.
No always-on notifications. Users must be online to send/receive messages.

## Current State
**Backend: COMPLETE ✅**
All backend functionality is implemented and tested.

**Frontend: NOT STARTED**
Only the default Vite + React + TypeScript scaffolding exists.
Need to build everything from scratch.

## Key Features
1. **Mutual friendship model**: Users send friend requests by email, recipient accepts/rejects
2. **Presence-based messaging**: Can ONLY message users who are currently online
3. **Real-time everything**: WebSocket delivers messages and presence changes instantly
4. **Auto-away/logout**: Away after 5 min idle, auto-logout after 15 min
5. **MSN-style contact list**: Online friends (expanded by default), Offline friends (collapsed)

## Tech Stack
**Backend:**
- Node.js + Express + TypeScript
- PostgreSQL via Prisma ORM
- Redis (for presence tracking)
- WebSockets (real-time messaging & presence)
- JWT authentication
- bcrypt for passwords

**Frontend (to build):**
- React + TypeScript + Vite (already scaffolded)
- Tailwind CSS only (no component library)
- React Router for navigation
- Classic desktop layout: sidebar with contacts + chat panel

## Backend API Endpoints

### Auth
- `POST /api/auth/register` - Create account (email, password, displayName)
- `POST /api/auth/login` - Get JWT token
- `GET /api/auth/me` - Get current user (protected)

### Friends
- `POST /api/friends/request` - Send friend request by email
- `POST /api/friends/accept/:friendshipId` - Accept a friend request
- `POST /api/friends/reject/:friendshipId` - Reject a friend request
- `GET /api/friends` - Get all friends with presence status
- `GET /api/friends/requests/pending` - Get incoming pending requests
- `DELETE /api/friends/:friendId` - Remove a friend

### Messages
- `POST /api/messages/send` - Send message (recipient must be online)
- `GET /api/messages/conversation/:friendId` - Get conversation history
- `POST /api/messages/read/:friendId` - Mark messages as read

## WebSocket Events

**Client → Server:**
- `{ type: 'heartbeat' }` - Update activity timestamp
- `{ type: 'message', recipientId, content }` - Send a message

**Server → Client:**
- `{ type: 'connected', userId }` - Connection established
- `{ type: 'message_received', message }` - New message from friend
- `{ type: 'message_sent', message }` - Your message was sent
- `{ type: 'message_failed', reason, recipientId, message }` - Message rejected (user offline)
- `{ type: 'presence_change', user: {id, displayName}, status }` - Friend came online/offline
- `{ type: 'heartbeat_ack' }` - Heartbeat acknowledged

## Data Types (from backend)

**User:**
```typescript
{
  id: string (uuid)
  email: string (unique)
  displayName: string
}
```

**Friend (from GET /api/friends):**
```typescript
{
  id: string
  email: string
  displayName: string
  status: 'online' | 'away' | 'offline'
  lastSeen: number (timestamp)
}
```

**Message:**
```typescript
{
  id: string
  fromUserId: string
  toUserId: string
  content: string
  sentAt: string (ISO timestamp)
  delivered: boolean
  read: boolean
  sender: {
    id: string
    displayName: string
  }
}
```

**FriendRequest:**
```typescript
{
  id: string (friendshipId)
  from: User
  createdAt: string
}
```

## Frontend Requirements

### Pages Needed
1. **Login** - Email + password, link to register
2. **Register** - Email + password + display name
3. **Main App** - Two-panel layout:
   - Left sidebar: Contact list with Online/Offline sections
   - Right panel: Chat window with selected friend

### Main App Layout (MSN-style)
```
┌─────────────────┬──────────────────────────┐
│  CONTACTS       │  Chat with [Friend]      │
│                 │                          │
│  Online ▼       │  [Message history]       │
│  • Alice        │                          │
│  • Bob          │                          │
│                 │                          │
│  Offline ▶      │  [Send message input]    │
│  (collapsed)    │                          │
│                 │                          │
│  [Add Friend]   │                          │
└─────────────────┴──────────────────────────┘
```

### Contact List Behavior
- **Online section**: Expanded by default, shows friends with status='online' or 'away'
- **Offline section**: Collapsed by default, shows friends with status='offline'
- **Add Friend button**: Opens modal to search by email and send request
- **Pending requests**: Show badge/notification somewhere
- **Click friend**: Opens chat in right panel

### Chat Window Behavior
- Show message history on open
- Send message input at bottom
- If friend goes offline while chatting: Disable input, show "User is offline"
- Real-time: New messages appear instantly via WebSocket
- Show if message failed to send (user went offline)

## Important Design Decisions Made
- **No queued/offline messages**: If recipient is offline, message is rejected immediately. This is the core feature, not a bug.
- **Mutual friendship required**: Not one-way contacts like WhatsApp. Both users must accept to see each other's presence.
- **Presence privacy**: Only accepted friends see your online status.

## Environment Variables

**Backend (.env):**
```
DATABASE_URL="postgresql://username@localhost:5432/disconnect_dev"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-secret-key"
PORT=3001
```

**Frontend (.env):**
```
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

## Development Workflow
```bash
# Terminal 1: Backend
cd backend && npm run dev  # Runs on :3001

# Terminal 2: Frontend
cd frontend && npm run dev  # Runs on :5173

# Services must be running:
brew services start postgresql@17
brew services start redis
```

## Testing the Backend
Backend is fully functional and tested. You can:
- Register/login users via API
- Connect to WebSocket with token
- Send friend requests, accept them
- Send messages between online users
- See real-time presence changes

See README.md for full API testing examples.

## Next Steps for Frontend
1. Set up React Router with Login/Register/Main routes
2. Create auth context/hook for managing JWT token and current user
3. Build Login and Register forms
4. Build main layout with contact list sidebar
5. Build chat window component
6. Wire up WebSocket for real-time events
7. Handle presence changes (friends coming online/offline)

## Design Preferences
- **Minimal**: Tailwind only, no component library, clean custom UI
- **Classic desktop**: Sidebar + panel layout, not mobile-first
- **Intentional**: Everything reinforces "online means present" philosophy
