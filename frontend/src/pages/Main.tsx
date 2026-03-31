import { useEffect, useState } from 'react'
import type { Friend } from '../types'
import ContactList from '../components/ContactList'
import ChatWindow from '../components/ChatWindow'
import TabStrip from '../components/TabStrip'
import { useWS } from '../contexts/WSContext'

export default function Main() {
  const { friends } = useWS()
  const [openTabIds, setOpenTabIds] = useState<string[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Remove tabs for friends that are no longer in the friends list
  useEffect(() => {
    const validIds = new Set(friends.map(f => f.id))
    setOpenTabIds(prev => prev.filter(id => validIds.has(id)))
    setActiveTabId(prev => (prev && validIds.has(prev) ? prev : null))
  }, [friends])

  const activeFriend = friends.find(f => f.id === activeTabId) ?? null
  const openTabs = openTabIds.map(id => friends.find(f => f.id === id)).filter(Boolean) as Friend[]

  function handleSelectFriend(friend: Friend) {
    if (!openTabIds.includes(friend.id)) {
      setOpenTabIds(prev => [...prev, friend.id])
    }
    setActiveTabId(friend.id)
  }

  function handleCloseTab(id: string) {
    setOpenTabIds(prev => prev.filter(tabId => tabId !== id))
    if (activeTabId === id) setActiveTabId(null)
  }

  function handleSwitchTab(id: string) {
    setActiveTabId(id)
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
        onSwitch={handleSwitchTab}
        onClose={handleCloseTab}
      />

      {activeFriend && (
        <div className="flex-1 flex flex-col">
          <ChatWindow
            key={activeFriend.id}
            friend={activeFriend}
            onClose={() => handleCloseTab(activeFriend.id)}
          />
        </div>
      )}
    </div>
  )
}
