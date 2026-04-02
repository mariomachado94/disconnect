export interface User {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

export interface Friend {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  status: 'online' | 'away' | 'offline'
  lastSeen: number
}

export interface Message {
  id: string
  fromUserId: string
  toUserId: string
  content: string
  sentAt: string
  deliveredAt: string | null
  readAt: string | null
  sender: {
    id: string
    displayName: string
    avatarUrl: string | null
  }
}

export interface FriendRequest {
  id: string
  from: User
  createdAt: string
}

export type WSMessage =
  | { type: 'connected'; userId: string }
  | { type: 'message_received'; message: Message }
  | { type: 'message_sent'; message: Message }
  | { type: 'message_failed'; reason: string; recipientId: string; message: string }
  | { type: 'presence_change'; user: { id: string; displayName: string; avatarUrl: string | null }; status: 'online' | 'away' | 'offline'; notify: boolean }
  | { type: 'friend_accepted'; friend: Friend }
  | { type: 'friend_request_received'; from: { id: string; displayName: string } }
  | { type: 'heartbeat_ack' }
  | { type: 'force_logout'; reason: string }
