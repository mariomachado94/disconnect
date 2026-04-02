import type { Friend } from '../types';
import Avatar from './Avatar';

interface Props {
  tabs: Friend[];
  activeId: string | null;
  unreadIds: Set<string>;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

export default function TabStrip({ tabs, activeId, unreadIds, onSwitch, onClose }: Props) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex flex-col w-[60px] shrink-0 h-full bg-gray-100 border-r border-gray-200">
      {tabs.map((friend) => {
        const isActive = activeId === friend.id;
        const hasUnread = unreadIds.has(friend.id);

        return (
          <div key={friend.id} className={`relative group w-[60px] h-[60px] flex items-center justify-center ${
                isActive
                  ? 'bg-white border-r-2 border-blue-600'
                  : hasUnread
                    ? 'bg-amber-50 hover:bg-amber-100'
                    : 'hover:bg-gray-200'
              }`}>
            <button
              onClick={() => onSwitch(friend.id)}
              title={friend.displayName}
              className={`rounded cursor-pointer ring-2 ${
                friend.status === 'online'
                  ? 'ring-green-500'
                  : friend.status === 'away'
                    ? 'ring-yellow-400'
                    : 'ring-gray-300'
              }`}
            >
              <Avatar displayName={friend.displayName} avatarUrl={friend.avatarUrl} size="md" />
            </button>

            {/* Unread dot */}
            {hasUnread && !isActive && (
              <span className="absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 pointer-events-none" />
            )}

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(friend.id);
              }}
              className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center text-xs text-gray-500 hover:text-gray-800 opacity-0 group-hover:opacity-100 cursor-pointer"
              aria-label={`Close ${friend.displayName}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
