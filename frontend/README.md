# Disconnect — Frontend

React + TypeScript + Vite + Tailwind CSS v4.

## Setup

```bash
npm install
npm run dev
```

A `.env` file is already committed with the default local dev values.

## Environment variables

| Variable | Example |
|---|---|
| `VITE_API_URL` | `http://localhost:3001` |
| `VITE_WS_URL` | `ws://localhost:3001` |

## Stack

- **React 19** with TypeScript
- **Vite 7** for bundling
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **React Router v7** for client-side routing
- Native **WebSocket API** (backend uses `ws`, not socket.io)

## Structure

```
src/
├── types/          # Shared TypeScript types
├── lib/api.ts      # REST API client
├── contexts/
│   ├── AuthContext.tsx   # JWT + current user
│   └── WSContext.tsx     # WebSocket connection, presence, messages, friend request notifications
├── pages/          # Login, Register, Main
└── components/     # ContactList, ChatWindow, AddFriendModal, PendingRequests
```
