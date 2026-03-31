import { useState } from 'react'
import type { Friend } from '../types'
import ContactList from '../components/ContactList'
import ChatWindow from '../components/ChatWindow'
import { useWS } from '../contexts/WSContext'

export default function Main() {
  const { friends } = useWS()
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)

  const selectedFriend = friends.find(f => f.id === selectedFriendId) ?? null

  function handleSelectFriend(friend: Friend) {
    setSelectedFriendId(friend.id)
  }

  function handleCloseChat() {
    setSelectedFriendId(null)
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <ContactList
        selectedFriendId={selectedFriendId}
        onSelectFriend={handleSelectFriend}
        fullscreen={!selectedFriend}
      />

      {selectedFriend && (
        <div className="flex-1 flex flex-col">
          <ChatWindow key={selectedFriend.id} friend={selectedFriend} onClose={handleCloseChat} />
        </div>
      )}
    </div>
  )
}
