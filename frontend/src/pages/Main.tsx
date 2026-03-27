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

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <ContactList
        selectedFriendId={selectedFriendId}
        onSelectFriend={handleSelectFriend}
      />

      <div className="flex-1 flex flex-col">
        {selectedFriend ? (
          <ChatWindow key={selectedFriend.id} friend={selectedFriend} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a friend to start chatting
          </div>
        )}
      </div>
    </div>
  )
}
