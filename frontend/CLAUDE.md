# Frontend — Detailed Patterns

This file documents non-obvious frontend behaviors. For architecture overview, commands, and API shapes, see the root `CLAUDE.md`.

## WS Effect Pattern

**WS effect depends only on `[token]` — all message handling is inline.** The `onmessage` handler uses `setMessages(prev => ...)` directly instead of external callbacks like `addMessage`. This is deliberate: Vite HMR preserves React state and memoized callbacks but does NOT re-run effects whose deps haven't changed. If the handler closed over `useCallback` helpers, an HMR update to those helpers would be invisible to the running `onmessage` — it would keep executing the old code. Inlining everything and depending only on `[token]` avoids stale closures. The same pattern applies to `logout` (accessed via `logoutRef`) and `user` (via `userRef`).

### StrictMode Double-Mount

The frontend uses an `active` flag in the WS `useEffect`. On cleanup, if the socket is still `CONNECTING`, it overrides `ws.onopen = () => ws.close()` instead of calling `ws.close()` directly. This avoids Chrome's "WebSocket closed before connection established" warning.

## Tabbed Chat Layout

`Main.tsx` manages two pieces of state: `openTabIds: string[]` (which chats are open, in order) and `activeTabId: string | null` (which is currently focused). The layout has three states:

| State | ContactList | TabStrip | ChatWindow |
|---|---|---|---|
| No open tabs | `flex-1` — fills screen | hidden | hidden |
| Tabs open, none active | `flex-1` — fills remaining space | visible | hidden |
| Tabs open, one active | `w-52` sidebar | visible | `flex-1` |

`ContactList` receives `fullscreen={activeTabId === null}` — it expands whenever no chat is active, regardless of whether tabs exist. `TabStrip` (`components/TabStrip.tsx`) renders `null` when `openTabIds` is empty.

**Closing a tab always sets `activeTabId` to `null`** — the user must explicitly click a tab to reopen a chat. No auto-selection of the next tab.

**Opening a chat** (clicking a contact) adds it to `openTabIds` if not already present, then sets it as active. Clicking a contact whose tab is already open just switches to it without duplicating.

**Tab strip** sits between ContactList and ChatWindow — a 60px wide vertical column of square boxes showing avatars (or initials fallback). Active tab has a right blue border + white background. Close button (×) appears on hover.

## Unread Tab State

`unreadIds: Set<string>` lives in `Main.tsx`. When a `message_received` WS event arrives for a sender who is not the active chat, their tab is opened (if not already), marked unread, and a notification sound plays. Unread tabs render with an amber background + small amber dot. The unread state clears when the user switches to, opens from the contact list, or closes that tab.

**`lastIncoming` in WSContext:** Set on every `message_received` event. `Main.tsx` watches it with a `useEffect` to drive tab-open and unread logic. An `activeTabIdRef` (kept in sync via a separate effect) lets the incoming-message effect read the current active tab without adding `activeTabId` as a dependency — otherwise the effect would re-run on every tab switch, not just on new messages.

## Optimistic Messages

When the user sends a message, WSContext generates a `clientId` (UUID), inserts an optimistic `Message` with `status: 'pending'` into the conversation immediately, and sends the `clientId` to the backend. The backend echoes `clientId` in `message_sent` / `message_failed` responses. On `message_sent`, the optimistic message is replaced by the real server message (matched by `clientId`). On `message_failed`, the optimistic message is marked `status: 'failed'` and shown inline with a red error indicator. Failed messages are cleared on `seedConversation` (chat reopen).

## Message Deduplication — `seedConversation`

When opening a chat, REST history is merged with any real-time WS messages already in memory. `seedConversation()` in WSContext deduplicates by message ID and sorts by `sentAt`.

**`seedConversation` prefers REST data over in-memory:** REST history (which has current `deliveredAt`/`readAt` from the DB) takes priority over stale in-memory versions. Only WS-only messages (arrived after the REST query) are kept from the existing array. Failed messages are dropped during merge.

## Session-Based Message Styling

`AuthContext` tracks `sessionStartedAt` (epoch ms) in both state and localStorage. It's set on `login()` / `register()` and survives page refreshes (same session). `ChatWindow` uses it to grey out messages from before the current session (pre-session messages get `bg-gray-50 text-gray-400`) and renders a "current session" divider line between the two groups. This means the 24-hour window from the backend may contain messages from a previous login — those appear greyed out rather than hidden.

## Activity-Aware Heartbeat

WSContext tracks real user activity (`mousemove`, `keydown`, `click`) via `lastActivityRef`. The heartbeat interval fires every 2 s but only sends a heartbeat to the server if the user was active in the last 2 s. If the user is idle, the heartbeat is skipped — allowing the backend's presence monitor to detect inactivity and transition the user to away/offline. Without this, the heartbeat alone would keep resetting `lastSeen` and the away/offline states would never trigger.

## `force_logout` Handling

WSContext handles `{ type: 'force_logout' }` by calling `logout()` from AuthContext, which clears the JWT and redirects to login. This is the only server-initiated session termination path.

## Notification Sounds

`lib/sound.ts` generates sounds via Web Audio API (no audio assets). `playNotification()` is a sharp sine chirp (660 → 880 Hz) for messages. `playFriendOnline()` is a softer triangle-wave chime (C5 → E5, 523 → 659 Hz) for friends coming online.

## Toast Notifications

`ToastContainer` renders a fixed-position stack in the top-right corner (`right-14` / 56px margin to always clear the 40px TabStrip). Toasts slide in from the right, fade out after 3.5s, and are removed from DOM at 3.8s. Two kinds: `friend-online` (green dot + "is now online") and `new-message` (blue dot + "New message from"). Toast state and the `addToast` helper live in `Main.tsx`. The `toastIdCounter` is a module-level variable (not state) to avoid stale closures in setTimeout callbacks.

## `presence_change` Notify Flag

Every `presence_change` WS event includes a `notify: boolean` field. The backend sets `notify: true` only for genuine offline → online transitions (first connection, not a grace-period reconnect). All other transitions (away → online, status updates) send `notify: false`. WSContext always updates the friends list for any presence_change, but only sets `lastPresenceChange` (which triggers toast/sound in Main.tsx) when `notify` is true. This keeps the "should we notify?" decision entirely on the backend, where all the context lives.

## Component Gotchas

**`pendingCount` / `pendingSeen` in WSContext:** Lives in WSContext (not ContactList) so the WS message handler can increment it when a `friend_request_received` event arrives.

**ContactItem defined outside ContactList:** Moving it inside causes React to remount all contact items on every parent re-render (e.g. every presence update). Keep it outside.

**ChatWindow keyed by friend ID:** `<ChatWindow key={activeFriend.id} />` in Main.tsx — ensures the component fully remounts (resets scroll, input, history fetch) when switching conversations.

**Avatar component:** Frontend prefixes `avatarUrl` with `VITE_API_URL` when rendering. The `Avatar` component handles the image-or-initials fallback logic — always use it instead of inline initials.
