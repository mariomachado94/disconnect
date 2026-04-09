import type { Friend } from '../types';
import Avatar from './Avatar';

interface Props {
  tabs: Friend[];
  activeId: string | null;
  unreadIds: Set<string>;
  onSwitch: (id: string) => void;
}

export default function TabStrip({ tabs, activeId, unreadIds, onSwitch }: Props) {
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

            {/* Unread badge */}
            {hasUnread && !isActive && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 pointer-events-none" />
            )}

          </div>
        );
      })}
    </div>
  );
}
