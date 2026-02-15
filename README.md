# Disconnect

Intentional messaging where "online" means present. No always-on notifications, no ambient anxiety.

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: React + TypeScript + Vite
- **Database**: PostgreSQL 17
- **ORM**: Prisma 5
- **Cache/Presence**: Redis
- **Real-time**: WebSockets
- **Auth**: JWT + bcrypt

## Prerequisites
```bash
# Check versions
node --version   # v20.x or v22.x
psql --version   # 17.x
redis-cli --version
```

## Development Setup
```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start services
brew services start postgresql@17
brew services start redis

# Run migrations
cd backend
npm run db:push
npm run prisma:generate

# Start dev servers (separate terminals)
cd backend && npm run dev    # http://localhost:3001
cd frontend && npm run dev   # http://localhost:5173
```

## Database Commands

### PostgreSQL Basics
```bash
# Connect to database
psql disconnect_dev

# Inside psql:
\dt                          # List tables
\d users                     # Describe users table
SELECT * FROM users;         # View all users
DELETE FROM users WHERE email = 'test@example.com';  # Delete user
\q                          # Quit

# From command line
psql disconnect_dev -c "SELECT * FROM users;"
```

### Prisma Commands
```bash
cd backend

# Open visual database browser
npm run prisma:studio        # http://localhost:5555

# Schema changes (development)
npm run db:push              # Quick sync schema to DB

# Schema changes (production-ready)
npm run prisma:migrate       # Create migration files

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Redis Commands
```bash
# Check if Redis is running
redis-cli ping               # Should return "PONG"

# Connect to Redis
redis-cli

# Inside redis-cli:
KEYS *                       # List all keys
GET online:user-id-here      # Get a specific key
FLUSHALL                     # Delete all keys (careful!)
exit                         # Quit
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Get JWT token
- `GET /api/auth/me` - Get current user (protected)

### Testing Auth
```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","displayName":"Test User"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Get current user (use token from login)
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Environment Variables

### Backend (.env)
```
DATABASE_URL="postgresql://your_username@localhost:5432/disconnect_dev"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-secret-key-change-in-production"
PORT=3001
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

## Useful Aliases

Add to `~/.zshrc`:
```bash
alias dcdev='cd ~/disconnect && code .'
alias dcback='cd ~/disconnect/backend && npm run dev'
alias dcfront='cd ~/disconnect/frontend && npm run dev'
alias dcdb='psql disconnect_dev'
```

## Project Structure
```
disconnect/
├── backend/
│   ├── src/
│   │   ├── routes/        # API endpoints
│   │   ├── middleware/    # Auth, etc.
│   │   ├── services/      # Business logic
│   │   ├── utils/         # Helpers
│   │   └── types/         # TypeScript types
│   ├── prisma/
│   │   └── schema.prisma  # Database schema
│   └── package.json
└── frontend/
    ├── src/
    └── package.json
```

## Common Tasks
```bash
# Add a new npm package
cd backend && npm install package-name

# View logs
cd backend && npm run dev  # Server logs appear here

# Check what's running on ports
lsof -i :3001  # Backend
lsof -i :5173  # Frontend
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
```

## Troubleshooting

### "Port already in use"
```bash
# Find and kill process
lsof -ti :3001 | xargs kill -9
```

### "Database does not exist"
```bash
createdb disconnect_dev
```

### Prisma Client out of sync
```bash
cd backend
npm run prisma:generate
```

### Redis not running
```bash
brew services restart redis
redis-cli ping
```
