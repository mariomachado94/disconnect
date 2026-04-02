import { useCallback, useEffect, useRef, useState } from 'react'
import type { Friend, Message } from '../types'
import type { PresenceChange } from '../contexts/WSContext'
import ContactList from '../components/ContactList'
import ChatWindow from '../components/ChatWindow'
import TabStrip from '../components/TabStrip'
import ToastContainer from '../components/ToastContainer'
import type { Toast } from '../components/ToastContainer'
import { useWS } from '../contexts/WSContext'
import { playNotification, playFriendOnline } from '../lib/sound'

let toastIdCounter = 0

export default function Main() {
  const { friends, lastIncoming, lastPresenceChange } = useWS()
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

  // Remove tabs for friends that are no longer in the friends list
  useEffect(() => {
    const validIds = new Set(friends.map(f => f.id))
    setOpenTabIds(prev => prev.filter(id => validIds.has(id)))
    setActiveTabId(prev => (prev && validIds.has(prev) ? prev : null))
  }, [friends])

  // Guards against StrictMode double-firing effects (same event processed twice)
  const lastProcessedIncoming = useRef<Message | null>(null)
  const lastProcessedPresence = useRef<PresenceChange | null>(null)

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
    <div className="flex h-screen bg-white overflow-hidden">
      <ContactList
        selectedFriendId={activeTabId}
        onSelectFriend={handleSelectFriend}
        fullscreen={activeTabId === null}
      />

      <TabStrip
        tabs={openTabs}
        activeId={activeTabId}
        unreadIds={unreadIds}
        onSwitch={handleSwitchTab}
        onClose={handleCloseTab}
      />

      {activeFriend && (
        <div className="flex-1 flex flex-col">
          <ChatWindow
            key={activeFriend.id}
            friend={activeFriend}
            onMinimize={handleMinimize}
            onClose={() => handleCloseTab(activeFriend.id)}
          />
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  )
}
