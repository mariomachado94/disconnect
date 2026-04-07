import { useEffect, useRef, useState } from 'react'
import type { Friend, Message } from '../types'
import { messagesApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useWS } from '../contexts/WSContext'

interface Props {
  friend: Friend
  onMinimize: () => void
  onClose: () => void
}

export default function ChatWindow({ friend, onMinimize, onClose }: Props) {
  const { token, user, sessionStartedAt } = useAuth()
  const { messages, seedConversation, sendMessage, lastFailedRecipient } = useWS()
  const [input, setInput] = useState('')
  const [, setHistoryLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversation: Message[] = messages[friend.id] ?? []
  const isOffline = friend.status === 'offline'
  const sendFailed = lastFailedRecipient === friend.id

  // Load conversation history
  useEffect(() => {
    if (!token) return
    setHistoryLoaded(false)
    messagesApi.getConversation(friend.id, token).then(history => {
      seedConversation(friend.id, history)
      setHistoryLoaded(true)
      messagesApi.markRead(friend.id, token).catch(() => {})
    })
  }, [friend.id, token, seedConversation])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const content = input.trim()
    if (!content || isOffline) return
    sendMessage(friend.id, content)
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${friend.status === 'online' ? 'bg-green-500' : friend.status === 'away' ? 'bg-yellow-400' : 'bg-gray-300'}`} />
        <span className="text-sm font-semibold text-gray-800">{friend.displayName}</span>
        <span className="text-xs text-gray-400 capitalize">{friend.status}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
            aria-label="Minimize chat"
          >
            −
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
            aria-label="Close chat"
          >
            ×
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-white">
        {conversation.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-8">
            {isOffline
              ? `${friend.displayName} is offline. Start a conversation when they come online.`
              : `Start your conversation with ${friend.displayName}`}
          </p>
        ) : (
          conversation.map((msg, idx) => {
            const isMe = msg.fromUserId === user?.id
            const msgTime = new Date(msg.sentAt).getTime()
            const isPreSession = sessionStartedAt != null && msgTime < sessionStartedAt

            // Show a divider before the first current-session message
            const prevMsg = idx > 0 ? conversation[idx - 1] : null
            const prevIsPreSession = prevMsg && sessionStartedAt != null && new Date(prevMsg.sentAt).getTime() < sessionStartedAt
            const showDivider = !isPreSession && (idx === 0 || prevIsPreSession)

            return (
              <div key={msg.id}>
                {showDivider && idx > 0 && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">current session</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                )}
                <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs px-3 py-1.5 text-sm ${
                    isPreSession
                      ? 'bg-gray-50 text-gray-400'
                      : isMe ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    <p>{msg.content}</p>
                    <p className={`text-[10px] mt-0.5 ${
                      isPreSession
                        ? 'text-gray-300'
                        : isMe ? 'text-blue-200' : 'text-gray-400'
                    }`}>
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Send failed notice */}
      {sendFailed && (
        <div className="px-4 py-1 bg-red-50 border-t border-red-200">
          <p className="text-xs text-red-600">Message not delivered — {friend.displayName} went offline.</p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
        {isOffline ? (
          <div className="text-xs text-gray-400 text-center py-1">
            {friend.displayName} is offline — you can't send messages right now
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Message ${friend.displayName}...`}
              className="flex-1 border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white"
              autoFocus
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="bg-blue-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
