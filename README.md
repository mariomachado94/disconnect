# Disconnect

Intentional messaging where "online" means present. No offline messaging, no queued messages, no background notifications. If a recipient is offline, the message is rejected immediately — this is a core feature, not a bug.

## Tech Stack

- **Backend**: Node.js + TypeScript + Express 5
- **Frontend**: React + TypeScript + Vite
- **Database**: PostgreSQL 17
- **ORM**: Prisma 5
- **Cache/Presence**: Redis
- **Real-time**: WebSockets (ws)
- **Auth**: JWT + bcrypt
- **File Uploads**: Multer

## Prerequisites

```bash
node --version      # v20.x or v22.x
psql --version      # 17.x
redis-cli --version # 7.x+
```

Install via Homebrew if needed:
```bash
brew install node postgresql@17 redis
```

## Development Setup

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Start services
brew services start postgresql@17
brew services start redis

# 3. Create the database (first time only)
createdb disconnect_dev

# 4. Configure environment
cp backend/.env.example backend/.env   # then edit with your values
cp frontend/.env.example frontend/.env # defaults are fine for local dev

# 5. Push schema to database
cd backend && npm run db:push

# 6. Start dev servers (separate terminals)
cd backend && npm run dev      # http://localhost:3001
cd frontend && npm run dev     # http://localhost:5173
```

## Running the App

### Backend (`cd backend`)
| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch, port 3001) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JS from `dist/` |
| `npm run db:push` | Push schema changes to DB (dev only, no migration files) |
| `npm run prisma:migrate` | Create and apply migration files |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:studio` | Visual DB browser at http://localhost:5555 |
| `npm run db:seed` | Seed test data |

### Frontend (`cd frontend`)
| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Type-check + production bundle |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |

## Environment Variables

### Backend (`backend/.env`)
```
DATABASE_URL="postgresql://your_username@localhost:5432/disconnect_dev"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-secret-key-change-in-production"
PORT=3001
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

## Debugging & Inspection Tools

### Prisma Studio

The easiest way to browse and edit database rows during development:

```bash
cd backend && npm run prisma:studio
# Opens at http://localhost:5555
```

Prisma Studio shows all tables, follows relationships, and lets you create/edit/delete rows directly. Best for quick data inspections.

### psql (PostgreSQL CLI)

For ad-hoc SQL queries, checking indexes, or anything Prisma Studio can't do:

```bash
# Connect
psql disconnect_dev

# Common commands inside psql:
\dt                          # List all tables
\d users                     # Describe a table's columns/indexes
\d messages                  # See message table structure
SELECT * FROM users;         # View all users
SELECT * FROM messages WHERE delivered_at IS NOT NULL;
\q                           # Quit

# One-liner from the shell
psql disconnect_dev -c "SELECT id, display_name, avatar_url FROM users;"
```

### pgAdmin (optional)

If you want a richer GUI than Prisma Studio with query editing, visual explains, and server monitoring, install [pgAdmin](https://www.pgadmin.org/). Not required — psql and Prisma Studio cover most needs.

### Redis CLI

```bash
# Check if Redis is running
redis-cli ping               # Should return "PONG"

# Connect interactively
redis-cli

# Inside redis-cli:
KEYS *                       # List all keys
KEYS online:*                # List presence keys
GET online:USER_ID           # Check a user's presence data
TTL blocklist:TOKEN_JTI      # Check remaining blocklist time
FLUSHALL                     # Delete all keys (careful!)
exit
```

Presence keys use the `online:` prefix. Token blocklist keys use `blocklist:`. Both auto-expire via TTL.

### WebSocket Debug Logging

Enable verbose WebSocket lifecycle logs (connections, disconnections, timers, presence monitor ticks):

```bash
DEBUG_WS=1 npm run dev
```

This toggles extra output from the `debugWs()` helper in `services/websocket.ts`. Standard operational logs (presence notifications, force-logout, errors) always print regardless of this flag.

### Presence Test Script

A manual scenario runner that validates multi-tab presence behavior:

```bash
cd backend
ALICE_TOKEN=<jwt> BOB_TOKEN=<jwt> node test-presence.js
```

Tests 7 scenarios: first login notification, second tab (no duplicate), close one tab (no change), close last tab (offline after grace period), reconnect, close again, and quick refresh (no offline/online flap).

### Port Inspection

```bash
lsof -i :3001   # Backend
lsof -i :5173   # Frontend (Vite)
lsof -i :5432   # PostgreSQL
lsof -i :5555   # Prisma Studio
lsof -i :6379   # Redis
```

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Get JWT token |
| `GET` | `/api/auth/me` | Get current user (protected) |

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123","displayName":"Alice"}'

# Login (save the token from the response)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# Get current user
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### Friends
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/friends/request` | Send friend request (by email) |
| `POST` | `/api/friends/accept/:friendshipId` | Accept a friend request |
| `POST` | `/api/friends/reject/:friendshipId` | Reject a friend request |
| `GET` | `/api/friends` | List friends with presence status |
| `GET` | `/api/friends/requests/pending` | List incoming pending requests |
| `DELETE` | `/api/friends/:friendId` | Remove a friend |

```bash
# Send friend request
curl -X POST http://localhost:3001/api/friends/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"email":"bob@example.com"}'

# Check pending requests
curl http://localhost:3001/api/friends/requests/pending \
  -H "Authorization: Bearer $BOB_TOKEN"

# Accept (use friendship ID from the response above)
curl -X POST http://localhost:3001/api/friends/accept/$FRIENDSHIP_ID \
  -H "Authorization: Bearer $BOB_TOKEN"

# List friends
curl http://localhost:3001/api/friends \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

### Messages
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/messages/send` | Send message (recipient must be online) |
| `GET` | `/api/messages/conversation/:friendId` | Get conversation history |
| `POST` | `/api/messages/read/:friendId` | Mark messages as read |

```bash
# Send a message (recipient must be connected via WebSocket)
curl -X POST http://localhost:3001/api/messages/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"recipientId":"BOB_USER_ID","content":"Hey Bob!"}'
```

### Avatar
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/avatar` | Upload profile picture (protected, max 2MB) |

Accepted formats: JPEG, PNG, GIF, WebP. Files are stored at `backend/uploads/avatars/` and served at `/uploads/avatars/...`.

```bash
# Upload an avatar
curl -X POST http://localhost:3001/api/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "avatar=@/path/to/photo.png"

# Verify it's served
curl -I http://localhost:3001/uploads/avatars/USER_ID.png
```

## WebSocket Protocol

**URL:** `ws://localhost:3001/ws?token=<jwt>`

### Client -> Server
| Type | Payload | Description |
|---|---|---|
| `heartbeat` | _(none)_ | Keep-alive, sent every 2s when user is active |
| `message` | `recipientId`, `content` | Send a chat message |

### Server -> Client
| Type | Description |
|---|---|
| `connected` | Confirmation after successful auth |
| `message_sent` | Acknowledgement with saved message |
| `message_received` | Incoming message from another user |
| `message_failed` | Recipient offline or other delivery error |
| `presence_change` | Friend went online/away/offline (includes `notify` flag) |
| `friend_accepted` | Someone accepted your friend request |
| `friend_request_received` | New incoming friend request |
| `heartbeat_ack` | Response to client heartbeat |
| `force_logout` | Server-initiated session termination (inactivity) |

### Testing with wscat
```bash
npm install -g wscat

# Connect as Alice
wscat -c "ws://localhost:3001/ws?token=$ALICE_TOKEN"

# Send a message (type this in the wscat prompt)
{"type":"message","recipientId":"BOB_USER_ID","content":"Hello!"}
```

## Project Structure

```
disconnect/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app, HTTP server, route mounting
│   │   ├── middleware/
│   │   │   └── auth.ts           # JWT validation middleware
│   │   ├── routes/
│   │   │   ├── auth.ts           # Register, login
│   │   │   ├── avatar.ts         # Avatar upload (multer)
│   │   │   ├── friends.ts        # Friend requests, list, remove
│   │   │   └── messages.ts       # Send, history, mark-read
│   │   ├── services/
│   │   │   ├── presence.ts       # Redis-backed presence (online/away/offline)
│   │   │   ├── tokenBlocklist.ts # Redis-backed JWT blocklist
│   │   │   ├── websocket.ts      # WebSocket server, connections, message routing
│   │   │   └── wsInstance.ts     # Singleton accessor for WS service
│   │   ├── types/
│   │   │   └── express.d.ts      # Express request augmentation
│   │   └── utils/
│   │       ├── jwt.ts            # Token generation/verification
│   │       ├── prisma.ts         # Prisma client instance
│   │       └── redis.ts          # Redis client instance
│   ├── prisma/
│   │   └── schema.prisma         # Database schema
│   ├── uploads/                  # Avatar files (gitignored except .gitkeep)
│   │   └── avatars/
│   ├── test-presence.js          # Manual WS presence scenario runner
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Router setup
│   │   ├── main.tsx              # Entry point
│   │   ├── components/
│   │   │   ├── AddFriendModal.tsx
│   │   │   ├── Avatar.tsx        # Shared avatar (image or initials fallback)
│   │   │   ├── AvatarUpload.tsx  # Avatar upload modal
│   │   │   ├── ChatWindow.tsx    # Message display + input
│   │   │   ├── ContactList.tsx   # Friends list with presence
│   │   │   ├── PendingRequests.tsx
│   │   │   ├── TabStrip.tsx      # Open chat tabs
│   │   │   └── ToastContainer.tsx
│   │   ├── contexts/
│   │   │   ├── AuthContext.tsx    # JWT + user state
│   │   │   └── WSContext.tsx      # WebSocket connection + real-time state
│   │   ├── lib/
│   │   │   ├── api.ts            # REST client
│   │   │   └── sound.ts          # Web Audio notification sounds
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   └── Main.tsx          # Three-panel layout, tab management
│   │   └── types/
│   │       └── index.ts          # Shared TypeScript interfaces
│   └── package.json
├── CLAUDE.md                     # AI assistant instructions
└── README.md                     # This file
```

## Troubleshooting

### "Port already in use"
```bash
lsof -ti :3001 | xargs kill -9
```

### "Database does not exist"
```bash
createdb disconnect_dev
```

### Prisma Client out of sync
After any schema.prisma change:
```bash
cd backend && npm run prisma:generate
```

### Redis not running
```bash
brew services restart redis
redis-cli ping   # Should return PONG
```

### WebSocket closes immediately
Check that the JWT is valid and not blocklisted. Tokens are blocklisted after 90s of disconnection or after inactivity force-logout. Re-login to get a fresh token.

### Avatar upload returns 400
- File must be under 2MB
- Only JPEG, PNG, GIF, and WebP are accepted
- The request must use `multipart/form-data` with field name `avatar`
