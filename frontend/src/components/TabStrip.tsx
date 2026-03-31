import type { Friend } from '../types'

interface Props {
  tabs: Friend[]
  activeId: string | null
  onSwitch: (id: string) => void
  onClose: (id: string) => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function TabStrip({ tabs, activeId, onSwitch, onClose }: Props) {
  if (tabs.length === 0) return null

  return (
    <div className="flex flex-col w-10 shrink-0 h-full bg-gray-100 border-r border-gray-200">
      {tabs.map(friend => (
        <div key={friend.id} className="relative group">
          <button
            onClick={() => onSwitch(friend.id)}
            title={friend.displayName}
            className={`w-10 h-10 flex items-center justify-center text-xs font-semibold cursor-pointer ${
              activeId === friend.id
                ? 'bg-white border-r-2 border-blue-600 text-blue-700'
                : 'text-gray-600 hover:bg-gray-200'
            }`}
          >
            {initials(friend.displayName)}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClose(friend.id) }}
            className="absolute top-0.5 right-0.5 w-3 h-3 flex items-center justify-center text-[9px] text-gray-500 hover:text-gray-800 opacity-0 group-hover:opacity-100 cursor-pointer"
            aria-label={`Close ${friend.displayName}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
