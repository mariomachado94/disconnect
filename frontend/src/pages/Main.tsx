import { useCallback, useEffect, useRef, useState } from 'react'
import type { Friend, Message } from '../types'
import type { PresenceChange } from '../contexts/WSContext'
import ContactList from '../components/ContactList'
import ChatWindow from '../components/ChatWindow'
import TabStrip from '../components/TabStrip'
import ToastContainer from '../components/ToastContainer'
import type { Toast } from '../components/ToastContainer'
import { useWS } from '../contexts/WSContext'
import { useAuth } from '../contexts/AuthContext'
import { messagesApi } from '../lib/api'
import { playNotification, playFriendOnline, playFriendRequest } from '../lib/sound'

let toastIdCounter = 0

export default function Main() {
  const { token } = useAuth()
  const { friends, lastIncoming, lastPresenceChange, lastFriendRequest, selfStatus } = useWS()
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<Toast[]>([])

  // Keep a ref so the incoming-message effect can read activeTabId without it
  // being a dependency (we only want to react to new messages, not tab switches)
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  const addToast = useCallback((kind: Toast['kind'], displayName: string) => {
    const id = ++toastIdCounter
    setToasts(prev => [...prev, { id, kind, displayName, exiting: false }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    }, 3500)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3800)
  }, [])

  // On startup, open tabs for any friends with unread messages from the last session.
  // Runs once per mount (after token is available). The friends-cleanup effect below
  // guards against friends = [] so it won't immediately wipe these tab IDs on load.
  const startupUnreadChecked = useRef(false)
  useEffect(() => {
    if (!token || startupUnreadChecked.current) return
    startupUnreadChecked.current = true
    messagesApi.getUnreadSenders(token).then(senderIds => {
      if (senderIds.length === 0) return
      setOpenTabIds(prev => {
        const next = [...prev]
        for (const id of senderIds) {
          if (!next.includes(id)) next.push(id)
        }
        return next
      })
      setUnreadIds(prev => new Set([...prev, ...senderIds]))
    })
  }, [token])

  // Remove tabs for friends that are no longer in the friends list.
  // Guard against friends = [] (not yet loaded) to avoid wiping startup tabs.
  useEffect(() => {
    if (friends.length === 0) return
    const validIds = new Set(friends.map(f => f.id))
    setOpenTabIds(prev => prev.filter(id => validIds.has(id)))
    setActiveTabId(prev => (prev && validIds.has(prev) ? prev : null))
  }, [friends])

  // Guards against StrictMode double-firing effects (same event processed twice)
  const lastProcessedIncoming = useRef<Message | null>(null)
  const lastProcessedPresence = useRef<PresenceChange | null>(null)
  const lastProcessedFriendRequest = useRef<typeof lastFriendRequest>(null)

  // React to incoming messages: open tab, mark unread, play sound, show toast
  useEffect(() => {
    if (!lastIncoming || lastIncoming === lastProcessedIncoming.current) return
    lastProcessedIncoming.current = lastIncoming
    const senderId = lastIncoming.fromUserId
    setOpenTabIds(prev => prev.includes(senderId) ? prev : [...prev, senderId])
    if (senderId !== activeTabIdRef.current) {
      setUnreadIds(prev => new Set([...prev, senderId]))
      playNotification()
      addToast('new-message', lastIncoming.sender.displayName)
    }
  }, [lastIncoming, addToast])

  // React to friends coming online: play sound, show toast
  useEffect(() => {
    if (!lastPresenceChange || lastPresenceChange === lastProcessedPresence.current) return
    lastProcessedPresence.current = lastPresenceChange
    if (lastPresenceChange.status !== 'online') return
    playFriendOnline()
    addToast('friend-online', lastPresenceChange.displayName)
  }, [lastPresenceChange, addToast])

  // React to incoming friend requests: play sound, show toast
  useEffect(() => {
    if (!lastFriendRequest || lastFriendRequest === lastProcessedFriendRequest.current) return
    lastProcessedFriendRequest.current = lastFriendRequest
    playFriendRequest()
    addToast('friend-request', lastFriendRequest.displayName)
  }, [lastFriendRequest, addToast])

  const activeFriend = friends.find(f => f.id === activeTabId) ?? null
  const openTabs = openTabIds.map(id => friends.find(f => f.id === id)).filter(Boolean) as Friend[]

  function handleSelectFriend(friend: Friend) {
    if (!openTabIds.includes(friend.id)) {
      setOpenTabIds(prev => [...prev, friend.id])
    }
    setActiveTabId(friend.id)
    setUnreadIds(prev => { const next = new Set(prev); next.delete(friend.id); return next })
  }

  function handleMinimize() {
    setActiveTabId(null)
  }

  function handleCloseTab(id: string) {
    setOpenTabIds(prev => prev.filter(tabId => tabId !== id))
    setUnreadIds(prev => { const next = new Set(prev); next.delete(id); return next })
    if (activeTabId === id) setActiveTabId(null)
  }

  function handleSwitchTab(id: string) {
    if (id === activeTabId) {
      setActiveTabId(null)
      return
    }
    setActiveTabId(id)
    setUnreadIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  return (
    <div className={`flex h-[100dvh] bg-white overflow-hidden ${activeFriend ? 'flex-col sm:flex-row' : 'flex-row'}`}>
      <ContactList
        selectedFriendId={activeTabId}
        onSelectFriend={handleSelectFriend}
        fullscreen={activeTabId === null}
        mobileCompact={!!activeFriend}
      />

      <TabStrip
        tabs={openTabs}
        activeId={activeTabId}
        unreadIds={unreadIds}
        onSwitch={handleSwitchTab}
        horizontal={!!activeFriend}
      />

      {activeFriend && (
        <div className="flex-1 min-h-0 flex flex-col">
          <ChatWindow
            key={activeFriend.id}
            friend={activeFriend}
            onMinimize={handleMinimize}
            onClose={() => handleCloseTab(activeFriend.id)}
          />
        </div>
      )}

      <ToastContainer toasts={toasts} />

      {selfStatus === 'away' && (
        <div className="fixed inset-0 bg-yellow-400/30 pointer-events-none" />
      )}
    </div>
  )
}
