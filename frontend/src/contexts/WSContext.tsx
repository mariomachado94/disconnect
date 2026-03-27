import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Friend, Message, WSMessage } from '../types'
import { useAuth } from './AuthContext'

interface WSContextValue {
  friends: Friend[]
  setFriends: React.Dispatch<React.SetStateAction<Friend[]>>
  messages: Record<string, Message[]>
  seedConversation: (friendId: string, history: Message[]) => void
  sendMessage: (recipientId: string, content: string) => void
  lastFailedRecipient: string | null
  isConnected: boolean
  pendingCount: number
  setPendingCount: React.Dispatch<React.SetStateAction<number>>
  pendingSeen: boolean
  setPendingSeen: React.Dispatch<React.SetStateAction<boolean>>
}

const WSContext = createContext<WSContextValue | null>(null)

const WS_URL = import.meta.env.VITE_WS_URL

export function WSProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [friends, setFriends] = useState<Friend[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [lastFailedRecipient, setLastFailedRecipient] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingSeen, setPendingSeen] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addMessage = useCallback((friendId: string, message: Message) => {
    setMessages(prev => ({
      ...prev,
      [friendId]: [...(prev[friendId] ?? []), message],
    }))
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }))
        }
      }, 30_000)
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
        addMessage(msg.message.fromUserId, msg.message)
      } else if (msg.type === 'message_sent') {
        addMessage(msg.message.toUserId, msg.message)
      } else if (msg.type === 'message_failed') {
        setLastFailedRecipient(msg.recipientId)
      } else if (msg.type === 'presence_change') {
        setFriends(prev =>
          prev.map(f =>
            f.id === msg.user.id ? { ...f, status: msg.status } : f
          )
        )
      } else if (msg.type === 'friend_accepted') {
        setFriends(prev => [...prev, msg.friend])
      } else if (msg.type === 'friend_request_received') {
        setPendingCount(prev => prev + 1)
        setPendingSeen(false)
      }
    }

    return () => {
      active = false
      if (ws.readyState === WebSocket.CONNECTING) {
        // Let it open then immediately close — avoids the Chrome warning for
        // closing a connecting socket, and the backend will ignore the disconnect
        // since a newer connection will have already replaced it in the map.
        ws.onopen = () => ws.close()
      } else {
        ws.close()
      }
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [token, addMessage])

  const seedConversation = useCallback((friendId: string, history: Message[]) => {
    setMessages(prev => {
      // Merge history with any real-time messages already received, deduplicating by id
      const existing = prev[friendId] ?? []
      const existingIds = new Set(existing.map(m => m.id))
      const newMessages = history.filter(m => !existingIds.has(m.id))
      const merged = [...newMessages, ...existing].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
      )
      return { ...prev, [friendId]: merged }
    })
  }, [])

  const sendMessage = useCallback((recipientId: string, content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setLastFailedRecipient(null)
      wsRef.current.send(JSON.stringify({ type: 'message', recipientId, content }))
    }
  }, [])

  return (
    <WSContext.Provider value={{ friends, setFriends, messages, seedConversation, sendMessage, lastFailedRecipient, isConnected, pendingCount, setPendingCount, pendingSeen, setPendingSeen }}>
      {children}
    </WSContext.Provider>
  )
}

export function useWS() {
  const ctx = useContext(WSContext)
  if (!ctx) throw new Error('useWS must be used within WSProvider')
  return ctx
}
