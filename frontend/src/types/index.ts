export interface User {
  id: string
  email: string
  displayName: string
}

export interface Friend {
  id: string
  email: string
  displayName: string
  status: 'online' | 'away' | 'offline'
  lastSeen: number
}

export interface Message {
  id: string
  fromUserId: string
  toUserId: string
  content: string
  sentAt: string
  delivered: boolean
  read: boolean
  sender: {
    id: string
    displayName: string
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
  | { type: 'presence_change'; user: { id: string; displayName: string }; status: 'online' | 'away' | 'offline' }
  | { type: 'friend_accepted'; friend: Friend }
  | { type: 'friend_request_received'; from: { id: string; displayName: string } }
  | { type: 'heartbeat_ack' }
  | { type: 'force_logout'; reason: string }
