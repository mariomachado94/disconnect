import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '../types'
import { authApi } from '../lib/api'

interface AuthContextValue {
  user: User | null
  token: string | null
  sessionStartedAt: number | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('sessionStartedAt')
    return stored ? parseInt(stored, 10) : null
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setIsLoading(false)
      return
    }
    authApi.me(token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('token')
        setToken(null)
      })
      .finally(() => setIsLoading(false))
  }, [token])

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password)
    const now = Date.now()
    localStorage.setItem('token', data.token)
    localStorage.setItem('sessionStartedAt', String(now))
    setToken(data.token)
    setSessionStartedAt(now)
    setUser(data.user)
  }, [])

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const data = await authApi.register(email, password, displayName)
    const now = Date.now()
    localStorage.setItem('token', data.token)
    localStorage.setItem('sessionStartedAt', String(now))
    setToken(data.token)
    setSessionStartedAt(now)
    setUser(data.user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('sessionStartedAt')
    setToken(null)
    setSessionStartedAt(null)
    setUser(null)
  }, [])

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, sessionStartedAt, login, register, logout, updateUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
