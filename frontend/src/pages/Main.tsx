import { useEffect, useRef, useState } from 'react'
import type { Friend } from '../types'
import ContactList from '../components/ContactList'
import ChatWindow from '../components/ChatWindow'
import TabStrip from '../components/TabStrip'
import { useWS } from '../contexts/WSContext'
import { playNotification } from '../lib/sound'

export default function Main() {
  const { friends, lastIncoming } = useWS()
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set())

  // Keep a ref so the incoming-message effect can read activeTabId without it
  // being a dependency (we only want to react to new messages, not tab switches)
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  // Remove tabs for friends that are no longer in the friends list
  useEffect(() => {
    const validIds = new Set(friends.map(f => f.id))
    setOpenTabIds(prev => prev.filter(id => validIds.has(id)))
    setActiveTabId(prev => (prev && validIds.has(prev) ? prev : null))
  }, [friends])

  // React to incoming messages: open tab, mark unread, play sound
  useEffect(() => {
    if (!lastIncoming) return
    const senderId = lastIncoming.fromUserId
    setOpenTabIds(prev => prev.includes(senderId) ? prev : [...prev, senderId])
    if (senderId !== activeTabIdRef.current) {
      setUnreadIds(prev => new Set([...prev, senderId]))
      playNotification()
    }
  }, [lastIncoming])

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
    </div>
  )
}
