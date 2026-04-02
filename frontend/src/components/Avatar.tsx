const API_URL = import.meta.env.VITE_API_URL

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-[48px] h-[48px] text-sm',
  lg: 'w-16 h-16 text-lg',
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface AvatarProps {
  displayName: string
  avatarUrl: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function Avatar({ displayName, avatarUrl, size = 'sm', className = '' }: AvatarProps) {
  const sizeClass = sizes[size]

  if (avatarUrl) {
    return (
      <img
        src={`${API_URL}${avatarUrl}`}
        alt={displayName}
        className={`${sizeClass} rounded object-cover shrink-0 ${className}`}
      />
    )
  }

  return (
    <div className={`${sizeClass} rounded bg-blue-100 text-blue-700 flex items-center justify-center font-semibold shrink-0 ${className}`}>
      {initials(displayName)}
    </div>
  )
}
