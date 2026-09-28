import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

interface GuideContextValue {
  channels: Channel[]
  programs: GuideProgram[]
  /** True until the first guide (or channel list) arrives. */
  loading: boolean
  error: string | null
  /** A manual discovery pass is running. */
  refreshing: boolean
  refresh: () => Promise<void>
}

const GuideContext = createContext<GuideContextValue | null>(null)

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [programs, setPrograms] = useState<GuideProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const apply = useCallback((guide: GuideData) => {
    setChannels(guide.channels)
    setPrograms(guide.programs)
    setLoading(false)
    setError(null)
  }, [])

  useEffect(() => {
    window.onair.getGuide()
      .then(apply)
      .catch((e) => { setError(String(e)); setLoading(false) })

    const unsubGuide = window.onair.onGuideUpdated(apply)
    // Discovery pushes the channel list before main has rebuilt the guide;
    // take it straight away so a new channel doesn't wait on TVmaze.
    const unsubChannels = window.onair.onChannelsUpdated((next) => {
      setChannels(next)
      setLoading(false)
    })
    return () => {
      unsubGuide()
      unsubChannels()
    }
  }, [apply])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setChannels(await window.onair.refreshChannels())
      apply(await window.onair.getGuide())
    } catch (e) {
      setError(String(e))
    } finally {
      setRefreshing(false)
    }
  }, [apply])

  return (
    <GuideContext.Provider value={{ channels, programs, loading, error, refreshing, refresh }}>
      {children}
    </GuideContext.Provider>
  )
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext)
  if (!ctx) throw new Error('useGuide must be used within GuideProvider')
  return ctx
}
