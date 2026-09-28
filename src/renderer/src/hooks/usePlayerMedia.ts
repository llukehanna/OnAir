import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  video0Ref: React.MutableRefObject<HTMLVideoElement | null>
  video1Ref: React.MutableRefObject<HTMLVideoElement | null>
  activeRef: React.MutableRefObject<HTMLVideoElement | null>
  liveLatency: number | null
  /** Changes whenever a new stream starts, resetting the live-edge baseline. */
  streamKey: string | null
}

export interface PlayerMedia {
  volume: number
  muted: boolean
  paused: boolean
  /** Seconds behind the best latency this stream has reached; 0 when at the edge. */
  behindBy: number
  setVolume: (v: number) => void
  toggleMute: () => void
  togglePause: () => void
  goLive: () => void
}

/** Past this many seconds behind the stream's own best, offer "Go live". */
const BEHIND_THRESHOLD_S = 8

function readVolume(): number {
  const parsed = parseFloat(localStorage.getItem('onair.volume') ?? '')
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.8
}

/**
 * Volume, mute, pause and live-edge state for the player's two video slots.
 *
 * Both elements get the same volume so the staging element is already right
 * when it swaps in (usePlayback also copies it across at swap time).
 */
export function usePlayerMedia({ video0Ref, video1Ref, activeRef, liveLatency, streamKey }: Options): PlayerMedia {
  const [volume, setVolumeState] = useState(readVolume)
  const [muted, setMuted] = useState(() => localStorage.getItem('onair.muted') === 'true')
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    for (const v of [video0Ref.current, video1Ref.current]) {
      if (!v) continue
      v.volume = volume
      v.muted = muted
    }
  })

  // Pause state follows whichever element is active.
  useEffect(() => {
    const els = [video0Ref.current, video1Ref.current].filter((v): v is HTMLVideoElement => !!v)
    const sync = () => setPaused(activeRef.current?.paused ?? false)
    for (const el of els) {
      el.addEventListener('play', sync)
      el.addEventListener('pause', sync)
      el.addEventListener('playing', sync)
    }
    sync()
    return () => {
      for (const el of els) {
        el.removeEventListener('play', sync)
        el.removeEventListener('pause', sync)
        el.removeEventListener('playing', sync)
      }
    }
  }, [video0Ref, video1Ref, activeRef, streamKey])

  // The best latency hls.js has held on this stream is "live" for our purposes.
  const bestRef = useRef<number | null>(null)
  useEffect(() => {
    bestRef.current = null
  }, [streamKey])
  if (liveLatency !== null && (bestRef.current === null || liveLatency < bestRef.current)) {
    bestRef.current = liveLatency
  }
  const behindBy = liveLatency !== null && bestRef.current !== null ? liveLatency - bestRef.current : 0

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    localStorage.setItem('onair.volume', String(v))
    if (v > 0) {
      setMuted(false)
      localStorage.setItem('onair.muted', 'false')
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      localStorage.setItem('onair.muted', String(!m))
      return !m
    })
  }, [])

  const togglePause = useCallback(() => {
    const v = activeRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [activeRef])

  const goLive = useCallback(() => {
    const v = activeRef.current
    if (!v) return
    const jump = behindBy
    if (jump > 0) v.currentTime = v.currentTime + jump
    if (v.paused) v.play().catch(() => {})
  }, [activeRef, behindBy])

  return {
    volume,
    muted,
    paused,
    behindBy: behindBy > BEHIND_THRESHOLD_S ? behindBy : 0,
    setVolume,
    toggleMute,
    togglePause,
    goLive,
  }
}
