import React, { createContext, useContext, useEffect, useState } from 'react'

interface GamesContextValue {
  games: Game[]
  loading: boolean
  error: string | null
}

const GamesContext = createContext<GamesContextValue | null>(null)

export function GamesProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.onair.getGames()
      .then((result) => { setGames(result); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })

    const unsub = window.onair.onGamesUpdated((update) => {
      setGames(update.games)
      setLoading(false)
      setError(null)
    })
    return unsub
  }, [])

  return (
    <GamesContext.Provider value={{ games, loading, error }}>
      {children}
    </GamesContext.Provider>
  )
}

export function useGames(): GamesContextValue {
  const ctx = useContext(GamesContext)
  if (!ctx) throw new Error('useGames must be used within GamesProvider')
  return ctx
}
