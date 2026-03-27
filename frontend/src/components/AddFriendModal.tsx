import { useState } from 'react'
import { friendsApi } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  onClose: () => void
  onRequestSent: () => void
}

export default function AddFriendModal({ onClose, onRequestSent }: Props) {
  const { token } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setError('')
    setLoading(true)
    try {
      await friendsApi.sendRequest(email, token)
      setSuccess(true)
      onRequestSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white border border-gray-300 w-72 p-5" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-bold text-gray-800 mb-3">Add a Friend</h2>

        {success ? (
          <div>
            <p className="text-xs text-green-700 mb-3">Friend request sent to {email}!</p>
            <button onClick={onClose} className="w-full bg-gray-200 text-gray-700 py-1.5 text-xs hover:bg-gray-300 cursor-pointer">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="friend@example.com"
                className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-100 text-gray-700 py-1.5 text-xs hover:bg-gray-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 text-white py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
