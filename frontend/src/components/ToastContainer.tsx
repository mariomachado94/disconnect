export interface Toast {
  id: number
  kind: 'friend-online' | 'new-message'
  displayName: string
  exiting: boolean
}

export default function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-14 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{ animation: toast.exiting ? 'toast-out 0.3s ease-in forwards' : 'toast-in 0.3s ease-out forwards' }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-w-48"
        >
          {toast.kind === 'friend-online' ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-gray-900">{toast.displayName}</span>
                <span className="text-gray-500"> is now online</span>
              </div>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <div className="text-sm">
                <span className="text-gray-500">New message from </span>
                <span className="font-medium text-gray-900">{toast.displayName}</span>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
