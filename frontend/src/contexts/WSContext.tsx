import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Friend, Message, WSMessage } from '../types'
import { useAuth } from './AuthContext'

export interface PresenceChange {
  userId: string
  displayName: string
  status: 'online' | 'away' | 'offline'
}

interface WSContextValue {
  friends: Friend[]
  setFriends: React.Dispatch<React.SetStateAction<Friend[]>>
  messages: Record<string, Message[]>
  seedConversation: (friendId: string, history: Message[]) => void
  sendMessage: (recipientId: string, content: string) => void
  lastIncoming: Message | null
  lastPresenceChange: PresenceChange | null
  isConnected: boolean
  selfStatus: 'online' | 'away'
  pendingCount: number
  setPendingCount: React.Dispatch<React.SetStateAction<number>>
  pendingSeen: boolean
  setPendingSeen: React.Dispatch<React.SetStateAction<boolean>>
}

const WSContext = createContext<WSContextValue | null>(null)

const WS_URL = import.meta.env.VITE_WS_URL

export function WSProvider({ children }: { children: ReactNode }) {
  const { token, user, logout } = useAuth()
  const [friends, setFriends] = useState<Friend[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [lastIncoming, setLastIncoming] = useState<Message | null>(null)
  const [lastPresenceChange, setLastPresenceChange] = useState<PresenceChange | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingSeen, setPendingSeen] = useState(false)
  const [selfStatus, setSelfStatus] = useState<'online' | 'away'>('online')
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const userRef = useRef(user)
  userRef.current = user
  const logoutRef = useRef(logout)
  logoutRef.current = logout

  // Track real user activity so the heartbeat only fires when the user is
  // actually interacting with the app, not just on a timer. Without this, the
  // heartbeat would keep resetting lastSeen even when the user walked away,
  // making the away/offline transitions never trigger.
  useEffect(() => {
    const markActive = () => { lastActivityRef.current = Date.now() }
    window.addEventListener('mousemove', markActive)
    window.addEventListener('keydown', markActive)
    window.addEventListener('click', markActive)
    // Mirror the backend's 30s away threshold locally so the UI can reflect it
    const statusCheck = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current
      setSelfStatus(idleMs < 30_000 ? 'online' : 'away')
    }, 2_000)
    return () => {
      window.removeEventListener('mousemove', markActive)
      window.removeEventListener('keydown', markActive)
      window.removeEventListener('click', markActive)
      clearInterval(statusCheck)
    }
  }, [])

  useEffect(() => {
    if (!token) return

    let active = true
    const ws = new WebSocket(`${WS_URL}/ws?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!active) {
        ws.close()
        return
      }
      setIsConnected(true)
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        // Only report activity if the user has interacted in the last 2s.
        // If they haven't, skip — the backend will transition them to away/offline.
        const idleMs = Date.now() - lastActivityRef.current
        if (idleMs < 2_000) {
          ws.send(JSON.stringify({ type: 'heartbeat' }))
        }
      }, 2_000)
    }

    ws.onclose = () => {
      if (!active) return
      setIsConnected(false)
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }

    ws.onmessage = (event) => {
      if (!active) return
      const msg: WSMessage = JSON.parse(event.data)

      if (msg.type === 'message_received') {
        setMessages(prev => ({
          ...prev,
          [msg.message.fromUserId]: [...(prev[msg.message.fromUserId] ?? []), msg.message],
        }))
        setLastIncoming(msg.message)
      } else if (msg.type === 'message_sent') {
        const { clientId } = msg
        const realMessage = msg.message
        const friendId = realMessage.toUserId
        setMessages(prev => {
          const msgs = prev[friendId] ?? []
          if (!clientId) {
            return { ...prev, [friendId]: [...msgs, realMessage] }
          }
          const idx = msgs.findIndex(m => m.clientId === clientId)
          if (idx === -1) {
            return { ...prev, [friendId]: [...msgs, realMessage] }
          }
          const updated = [...msgs]
          updated[idx] = realMessage
          return { ...prev, [friendId]: updated }
        })
      } else if (msg.type === 'message_failed') {
        const { clientId, recipientId } = msg
        if (!clientId) return
        setMessages(prev => {
          const msgs = prev[recipientId]
          if (!msgs) return prev
          const idx = msgs.findIndex(m => m.clientId === clientId)
          if (idx === -1) return prev
          const updated = [...msgs]
          updated[idx] = { ...msgs[idx], status: 'failed' as const }
          return { ...prev, [recipientId]: updated }
        })
      } else if (msg.type === 'message_delivered') {
        setMessages(prev => {
          for (const friendId of Object.keys(prev)) {
            const msgs = prev[friendId]
            const idx = msgs.findIndex(m => m.id === msg.messageId)
            if (idx !== -1) {
              const updated = [...msgs]
              updated[idx] = { ...msgs[idx], deliveredAt: msg.deliveredAt }
              return { ...prev, [friendId]: updated }
            }
          }
          return prev
        })
      } else if (msg.type === 'message_read') {
        setMessages(prev => {
          for (const friendId of Object.keys(prev)) {
            const msgs = prev[friendId]
            const targetIdx = msgs.findIndex(m => m.id === msg.messageId)
            if (targetIdx === -1) continue
            const targetSentAt = new Date(msgs[targetIdx].sentAt).getTime()
            const currentUserId = userRef.current?.id
            return {
              ...prev,
              [friendId]: msgs.map(m => {
                if (m.fromUserId !== currentUserId) return m
                if (new Date(m.sentAt).getTime() > targetSentAt) return m
                return {
                  ...m,
                  readAt: m.readAt ?? msg.readAt,
                  deliveredAt: m.deliveredAt ?? msg.readAt,
                }
              }),
            }
          }
          return prev
        })
      } else if (msg.type === 'presence_change') {
        // Always update friends list so the contact list shows current status
        setFriends(prev =>
          prev.map(f =>
            f.id === msg.user.id ? { ...f, status: msg.status, avatarUrl: msg.user.avatarUrl } : f
          )
        )
        // Only trigger toast/sound for notable transitions (the backend
        // sets notify: true only for genuine offline → online).
        if (msg.notify) {
          setLastPresenceChange({ userId: msg.user.id, displayName: msg.user.displayName, status: msg.status })
        }
      } else if (msg.type === 'friend_accepted') {
        setFriends(prev => [...prev, msg.friend])
      } else if (msg.type === 'friend_request_received') {
        setPendingCount(prev => prev + 1)
        setPendingSeen(false)
      } else if (msg.type === 'force_logout') {
        logoutRef.current()
      }
    }

    return () => {
      active = false
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close()
      } else {
        ws.close()
      }
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [token])

  const seedConversation = useCallback((friendId: string, history: Message[]) => {
    setMessages(prev => {
      const existing = prev[friendId] ?? []
      // REST history has the latest deliveredAt/readAt from DB — prefer it over
      // stale in-memory versions. Keep only WS-only messages from existing array
      // and drop failed/pending messages on merge.
      const historyMap = new Map(history.map(m => [m.id, m]))
      const merged = [
        ...history,
        ...existing.filter(m => !historyMap.has(m.id) && !m.status),
      ].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      return { ...prev, [friendId]: merged }
    })
  }, [])

  const sendMessage = useCallback((recipientId: string, content: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    const currentUser = userRef.current
    if (!currentUser) return

    const clientId = crypto.randomUUID()

    // Optimistically add the message to the conversation
    const optimistic: Message = {
      id: clientId,
      clientId,
      status: 'pending',
      fromUserId: currentUser.id,
      toUserId: recipientId,
      content,
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      sender: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
      },
    }
    setMessages(prev => ({
      ...prev,
      [recipientId]: [...(prev[recipientId] ?? []), optimistic],
    }))

    wsRef.current.send(JSON.stringify({ type: 'message', recipientId, content, clientId }))
  }, [])

  return (
    <WSContext.Provider value={{ friends, setFriends, messages, seedConversation, sendMessage, lastIncoming, lastPresenceChange, isConnected, selfStatus, pendingCount, setPendingCount, pendingSeen, setPendingSeen }}>
      {children}
    </WSContext.Provider>
  )
}

export function useWS() {
  const ctx = useContext(WSContext)
  if (!ctx) throw new Error('useWS must be used within WSProvider')
  return ctx
}
