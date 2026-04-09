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
  clientId?: string
  status?: 'pending' | 'failed'
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
  | { type: 'message_sent'; message: Message; clientId: string }
  | { type: 'message_failed'; reason: string; recipientId: string; message: string; clientId: string }
  | { type: 'message_delivered'; messageId: string; deliveredAt: string }
  | { type: 'message_read'; messageId: string; readAt: string }
  | { type: 'presence_change'; user: { id: string; displayName: string; avatarUrl: string | null }; status: 'online' | 'away' | 'offline'; notify: boolean }
  | { type: 'friend_accepted'; friend: Friend }
  | { type: 'friend_request_received'; from: { id: string; displayName: string } }
  | { type: 'profile_updated'; user: { id: string; displayName: string; avatarUrl: string | null } }
  | { type: 'heartbeat_ack' }
  | { type: 'force_logout'; reason: string }
