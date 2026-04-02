import type { Friend, FriendRequest, Message, User } from '../types'

const BASE = import.meta.env.VITE_API_URL

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  const data = await res.json()
  if (!res.ok) {
    // Backend returns either { error: string } or { errors: [{msg, path}...] } from express-validator
    const msg = data.error || data.message ||
      (Array.isArray(data.errors) && data.errors.map((e: { msg: string; path: string }) => `${e.path}: ${e.msg}`).join(', ')) ||
      'Request failed'
    throw new Error(msg)
  }
  return data
}

// Auth
export const authApi = {
  register: (email: string, password: string, displayName: string) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) =>
    request<{ user: User }>('/api/auth/me', {}, token).then(r => r.user),
}

// Friends
export const friendsApi = {
  getAll: (token: string) =>
    request<{ friends: Friend[] }>('/api/friends', {}, token).then(r => r.friends),

  getPending: (token: string) =>
    request<{ requests: FriendRequest[] }>('/api/friends/requests/pending', {}, token).then(r => r.requests),

  sendRequest: (email: string, token: string) =>
    request('/api/friends/request', { method: 'POST', body: JSON.stringify({ email }) }, token),

  accept: (friendshipId: string, token: string) =>
    request(`/api/friends/accept/${friendshipId}`, { method: 'POST' }, token),

  reject: (friendshipId: string, token: string) =>
    request(`/api/friends/reject/${friendshipId}`, { method: 'POST' }, token),

  remove: (friendId: string, token: string) =>
    request(`/api/friends/${friendId}`, { method: 'DELETE' }, token),
}

// Messages
export const messagesApi = {
  getConversation: (friendId: string, token: string) =>
    request<{ messages: Message[] }>(`/api/messages/conversation/${friendId}`, {}, token).then(r => r.messages),

  markRead: (friendId: string, token: string) =>
    request(`/api/messages/read/${friendId}`, { method: 'POST' }, token),
}

// Avatar
export const avatarApi = {
  upload: async (file: File, token: string): Promise<User> => {
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await fetch(`${BASE}/api/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return data.user
  },
}
