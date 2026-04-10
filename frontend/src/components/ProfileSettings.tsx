import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { profileApi } from '../lib/api'

interface Props {
  onClose: () => void
}

export default function ProfileSettings({ onClose }: Props) {
  const { token, user, updateUser } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!token) return
    const trimmed = displayName.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      const updated = await profileApi.updateDisplayName(trimmed, token)
      updateUser({ displayName: updated.displayName })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-5 w-80" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-800 mb-3">Profile Settings</h3>

        <label className="block text-xs text-gray-500 mb-1">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          maxLength={50}
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-base mb-3 focus:outline-none focus:border-blue-400"
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          autoFocus
        />

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!displayName.trim() || saving}
            className="flex-1 bg-blue-600 text-white text-xs py-1.5 rounded hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-600 text-xs py-1.5 rounded hover:bg-gray-200 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
