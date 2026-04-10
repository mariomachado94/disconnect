import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const { messages, seedConversation, sendMessage } = useWS()
  const [input, setInput] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const spacerDivRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)
  const initialSpacerRef = useRef(0)
  const prevLengthRef = useRef(0)

  const conversation: Message[] = messages[friend.id] ?? []
  const isOffline = friend.status === 'offline'
  const [missedIds, setMissedIds] = useState<Set<string>>(new Set())
  const [spacerHeight, setSpacerHeight] = useState(0)

  // Load conversation history
  useEffect(() => {
    if (!token) return
    setHistoryLoaded(false)
    messagesApi.getConversation(friend.id, token).then(history => {
      // Identify "missed" messages: sent by the friend before this session,
      // never read (readAt null). Only detected on first load — markRead below
      // will set readAt on the backend, so subsequent loads won't flag them.
      if (sessionStartedAt != null) {
        const missed = new Set(
          history
            .filter(m =>
              m.fromUserId === friend.id &&
              new Date(m.sentAt).getTime() < sessionStartedAt &&
              !m.readAt
            )
            .map(m => m.id)
        )
        setMissedIds(missed)
      }
      seedConversation(friend.id, history)
      setHistoryLoaded(true)
      messagesApi.markRead(friend.id, token).catch(() => {})
    })
  }, [friend.id, token, seedConversation, sessionStartedAt])

  // Mark new incoming messages as read while chat is open
  useEffect(() => {
    if (!token) return
    if (conversation.length > prevLengthRef.current) {
      const newMsgs = conversation.slice(prevLengthRef.current)
      if (newMsgs.some(m => m.fromUserId === friend.id)) {
        messagesApi.markRead(friend.id, token).catch(() => {})
      }
    }
    prevLengthRef.current = conversation.length
  }, [conversation.length, friend.id, token])

  // Whether all loaded messages are from a previous session (no current-session
  // messages yet). Used to render the trailing session divider.
  const allPreSession = historyLoaded && sessionStartedAt != null && conversation.length > 0 &&
    new Date(conversation[conversation.length - 1].sentAt).getTime() < sessionStartedAt

  useLayoutEffect(() => {
    if (!historyLoaded) return
    if (!initialScrollDone.current) {
      if (dividerRef.current && scrollRef.current && spacerDivRef.current) {
        // Set spacer height directly in the DOM (no re-render needed before scroll),
        // then scroll immediately — all before the first paint, no flicker.
        const initial = scrollRef.current.clientHeight * 0.65
        initialSpacerRef.current = initial
        spacerDivRef.current.style.height = `${initial}px`
        const c = scrollRef.current
        const dividerOffset =
          dividerRef.current.getBoundingClientRect().top -
          c.getBoundingClientRect().top +
          c.scrollTop
        c.scrollTop = Math.max(0, dividerOffset - c.clientHeight * 0.35)
        // Sync React state — DOM already shows the right value so no visible change
        setSpacerHeight(initial)
      } else if (scrollRef.current) {
        // No divider (all current-session messages) — scroll to bottom before paint
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight - scrollRef.current.clientHeight
      }
      return
    }
    // Shrink spacer as current-session messages accumulate below the divider
    if (!initialSpacerRef.current || !dividerRef.current || !bottomRef.current) return
    const dividerBottom = dividerRef.current.getBoundingClientRect().bottom
    const bottomTop = bottomRef.current.getBoundingClientRect().top
    const contentBelowDivider = Math.max(0, bottomTop - dividerBottom)
    setSpacerHeight(Math.max(0, initialSpacerRef.current - contentBelowDivider))
  }, [conversation, historyLoaded])

  useEffect(() => {
    if (historyLoaded && !initialScrollDone.current) {
      initialScrollDone.current = true
      // Initial scroll fully handled in useLayoutEffect above (before paint).
      return
    }
    if (initialScrollDone.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight - scrollRef.current.clientHeight,
        behavior: 'smooth',
      })
    }
  }, [conversation, historyLoaded])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const content = input.trim()
    if (!content || isOffline) return
    sendMessage(friend.id, content)
    setInput('')
  }

  // Compute delivery/read label positions (only for my non-failed messages)
  const myMessages = conversation
    .map((msg, idx) => ({ msg, idx }))
    .filter(({ msg }) => msg.fromUserId === user?.id && msg.status !== 'failed')

  let lastReadIdx = -1
  for (let i = myMessages.length - 1; i >= 0; i--) {
    if (myMessages[i].msg.readAt) { lastReadIdx = myMessages[i].idx; break }
  }

  let lastDeliveredIdx = -1
  for (let i = myMessages.length - 1; i >= 0; i--) {
    if (myMessages[i].idx <= lastReadIdx) break
    if (myMessages[i].msg.deliveredAt && !myMessages[i].msg.readAt) {
      lastDeliveredIdx = myMessages[i].idx; break
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${friend.status === 'online' ? 'bg-green-500' : friend.status === 'away' ? 'bg-yellow-400' : 'bg-gray-300'}`} />
        <span className="text-sm font-semibold text-gray-800">{friend.displayName}</span>
        <span className="text-xs text-gray-400 capitalize">{friend.status}</span>
        <div className="ml-auto flex items-center gap-3">
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
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 bg-white">
        {!historyLoaded ? null : conversation.length === 0 ? (
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
            const isMissed = missedIds.has(msg.id)
            const isGreyedOut = isPreSession && !isMissed
            const isFailed = isMe && msg.status === 'failed'

            // Show a divider before the first current-session message
            const prevMsg = idx > 0 ? conversation[idx - 1] : null
            const prevIsPreSession = prevMsg && sessionStartedAt != null && new Date(prevMsg.sentAt).getTime() < sessionStartedAt
            const showDivider = !isPreSession && (idx === 0 || prevIsPreSession)

            return (
              <div key={msg.id}>
                {showDivider && idx > 0 && (
                  <div ref={dividerRef} className="flex items-center gap-2 my-3">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">current session</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                )}
                <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-1`}>
                  <div className={`max-w-xs px-3 py-1.5 text-sm ${
                    isGreyedOut
                      ? 'bg-gray-50 text-gray-400'
                      : isFailed
                        ? 'bg-red-50 text-gray-800'
                        : isMe ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    <p>{msg.content}</p>
                    <p className={`text-[10px] mt-0.5 ${
                      isGreyedOut
                        ? 'text-gray-300'
                        : isFailed
                          ? 'text-red-400'
                          : isMe ? 'text-blue-200' : 'text-gray-400'
                    }`}>
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {isFailed && (
                    <span className="text-red-500 text-xs mb-1 font-bold" title="Message not delivered">!</span>
                  )}
                </div>
                {idx === lastReadIdx && (
                  <p className="text-[10px] text-gray-400 text-right mt-0.5">Read</p>
                )}
                {idx === lastDeliveredIdx && (
                  <p className="text-[10px] text-gray-400 text-right mt-0.5">Delivered</p>
                )}
                {missedIds.has(msg.id) && (
                  <p className="text-[10px] text-red-400 text-left mt-0.5">Missed</p>
                )}
              </div>
            )
          })
        )}
        {/* Trailing session divider: shown when all messages are pre-session */}
        {historyLoaded && allPreSession && (
          <div ref={dividerRef} className="flex items-center gap-2 my-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-[10px] text-gray-400 whitespace-nowrap">current session</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>
        )}
        <div ref={bottomRef} />
        {/* Spacer shrinks as current-session messages fill the space.
            Always rendered so spacerDivRef is available for pre-paint DOM manipulation. */}
        <div ref={spacerDivRef} style={{ height: spacerHeight, marginTop: 0 }} />
      </div>

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
              className="flex-1 border border-gray-300 px-3 py-1.5 text-base focus:outline-none focus:border-blue-500 bg-white"
              enterKeyHint="send"
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
