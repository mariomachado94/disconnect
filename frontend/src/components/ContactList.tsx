import { useEffect, useState } from 'react'
import type { Friend } from '../types'
import { friendsApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useWS } from '../contexts/WSContext'
import Avatar from './Avatar'
import AddFriendModal from './AddFriendModal'
import PendingRequests from './PendingRequests'
import AvatarUpload from './AvatarUpload'

interface Props {
  selectedFriendId: string | null
  onSelectFriend: (friend: Friend) => void
  fullscreen?: boolean
}

function statusDot(status: Friend['status']) {
  if (status === 'online') return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
  if (status === 'away') return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
  return <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
}

interface ContactItemProps {
  friend: Friend
  isSelected: boolean
  onSelect: (friend: Friend) => void
}

function ContactItem({ friend, isSelected, onSelect }: ContactItemProps) {
  return (
    <button
      onClick={() => onSelect(friend)}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-blue-50 cursor-pointer ${isSelected ? 'bg-blue-100' : ''}`}
    >
      {statusDot(friend.status)}
      <span className="text-sm text-gray-800 truncate">{friend.displayName}</span>
    </button>
  )
}

export default function ContactList({ selectedFriendId, onSelectFriend, fullscreen }: Props) {
  const { token, user, logout } = useAuth()
  const { friends, setFriends, selfStatus, pendingCount, setPendingCount, pendingSeen, setPendingSeen } = useWS()
  const [onlineExpanded, setOnlineExpanded] = useState(true)
  const [offlineExpanded, setOfflineExpanded] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [showAvatarUpload, setShowAvatarUpload] = useState(false)

  useEffect(() => {
    if (!token) return
    friendsApi.getAll(token).then(setFriends)
    friendsApi.getPending(token).then(reqs => setPendingCount(reqs.length))
  }, [token, setFriends])

  const online = friends.filter(f => f.status === 'online' || f.status === 'away')
  const offline = friends.filter(f => f.status === 'offline')

  return (
    <div className={`flex flex-col h-full bg-gray-50 border-r border-gray-200 ${fullscreen ? 'flex-1' : 'w-52 shrink-0'}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
        <button onClick={() => setShowAvatarUpload(true)} className={`rounded ring-2 cursor-pointer ${selfStatus === 'online' ? 'ring-green-500' : 'ring-yellow-400'}`} title="Change avatar">
          <Avatar displayName={user?.displayName ?? ''} avatarUrl={user?.avatarUrl ?? null} size="sm" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-700 truncate">{user?.displayName}</p>
          <p className="text-xs text-gray-400 truncate">{user?.email}</p>
        </div>
      </div>

      {/* Contact groups */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Online */}
        <button
          onClick={() => setOnlineExpanded(e => !e)}
          className="w-full flex items-center gap-1 px-3 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          <span>{onlineExpanded ? '▼' : '▶'}</span>
          <span>Online ({online.length})</span>
        </button>
        {onlineExpanded && online.map(f => (
          <ContactItem key={f.id} friend={f} isSelected={f.id === selectedFriendId} onSelect={onSelectFriend} />
        ))}

        {/* Offline */}
        <button
          onClick={() => setOfflineExpanded(e => !e)}
          className="w-full flex items-center gap-1 px-3 py-1 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer mt-1"
        >
          <span>{offlineExpanded ? '▼' : '▶'}</span>
          <span>Offline ({offline.length})</span>
        </button>
        {offlineExpanded && offline.map(f => (
          <ContactItem key={f.id} friend={f} isSelected={f.id === selectedFriendId} onSelect={onSelectFriend} />
        ))}
      </div>

      {/* Footer actions */}
      <div className="border-t border-gray-200 p-2 space-y-1">
        <button
          onClick={() => { setShowPending(true); setPendingSeen(true) }}
          className="w-full flex items-center justify-between px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 cursor-pointer"
        >
          <span>Friend Requests</span>
          {pendingCount > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] text-white ${pendingSeen ? 'bg-gray-400' : 'bg-red-500'}`}>
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowAddFriend(true)}
          className="w-full px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 text-left cursor-pointer"
        >
          + Add Friend
        </button>
        <button
          onClick={logout}
          className="w-full px-2 py-1 text-xs text-gray-400 hover:text-gray-600 text-left cursor-pointer"
        >
          Sign out
        </button>
      </div>

      {showAddFriend && (
        <AddFriendModal
          onClose={() => setShowAddFriend(false)}
          onRequestSent={() => {}}
        />
      )}
      {showPending && (
        <PendingRequests onClose={() => {
          setShowPending(false)
          if (token) friendsApi.getPending(token).then(reqs => setPendingCount(reqs.length))
        }} />
      )}
      {showAvatarUpload && (
        <AvatarUpload onClose={() => setShowAvatarUpload(false)} />
      )}
    </div>
  )
}
