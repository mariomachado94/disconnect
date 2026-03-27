import { useEffect, useState } from 'react'
import type { FriendRequest } from '../types'
import { friendsApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useWS } from '../contexts/WSContext'

interface Props {
  onClose: () => void
}

export default function PendingRequests({ onClose }: Props) {
  const { token } = useAuth()
  const { setFriends } = useWS()
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    friendsApi.getPending(token)
      .then(setRequests)
      .finally(() => setLoading(false))
  }, [token])

  async function accept(req: FriendRequest) {
    if (!token) return
    try {
      await friendsApi.accept(req.id, token)
      setRequests(prev => prev.filter(r => r.id !== req.id))
      // Refresh friends list
      const updated = await friendsApi.getAll(token)
      setFriends(updated)
    } catch {
      // ignore
    }
  }

  async function reject(req: FriendRequest) {
    if (!token) return
    try {
      await friendsApi.reject(req.id, token)
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white border border-gray-300 w-80 p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-gray-800 mb-3">Friend Requests</h2>

        {loading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : requests.length === 0 ? (
          <p className="text-xs text-gray-500">No pending requests.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map(req => (
              <li key={req.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{req.from.displayName}</p>
                  <p className="text-xs text-gray-500">{req.from.email}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => accept(req)}
                    className="bg-green-600 text-white text-xs px-2 py-1 hover:bg-green-700 cursor-pointer"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => reject(req)}
                    className="bg-gray-200 text-gray-700 text-xs px-2 py-1 hover:bg-gray-300 cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full bg-gray-100 text-gray-700 py-1.5 text-xs hover:bg-gray-200 cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  )
}
