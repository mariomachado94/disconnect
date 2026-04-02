import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { avatarApi } from '../lib/api'

const API_URL = import.meta.env.VITE_API_URL

interface Props {
  onClose: () => void
}

export default function AvatarUpload({ onClose }: Props) {
  const { token, user, updateUser } = useAuth()
  const [preview, setPreview] = useState<string | null>(
    user?.avatarUrl ? `${API_URL}${user.avatarUrl}` : null
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setSelectedFile(file)
    setPreview(URL.createObjectURL(file))
  }

  async function handleUpload() {
    if (!selectedFile || !token) return

    setUploading(true)
    setError('')
    try {
      const updated = await avatarApi.upload(selectedFile, token)
      updateUser({ avatarUrl: updated.avatarUrl })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-5 w-80" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-800 mb-3">Change Avatar</h3>

        {preview && (
          <div className="flex justify-center mb-3">
            <img src={preview} alt="Preview" className="w-20 h-20 rounded object-cover" />
          </div>
        )}

        <label className="block w-full text-center text-xs py-2 px-3 mb-3 border border-dashed border-gray-300 rounded cursor-pointer hover:border-blue-400 hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition-colors">
          {selectedFile ? selectedFile.name : 'Choose an image...'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="flex-1 bg-blue-600 text-white text-xs py-1.5 rounded hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
          >
            {uploading ? 'Uploading...' : 'Upload'}
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
