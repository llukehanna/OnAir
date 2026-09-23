import React, { useState, useEffect, useRef } from 'react'
import { Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react'
import styles from './PlayerControls.module.css'

interface PlayerControlsProps {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  gameTitle: string
  gameClock: string
  visible: boolean
}

export function PlayerControls({
  videoRef,
  gameTitle,
  gameClock,
  visible,
}: PlayerControlsProps): React.JSX.Element {
  const [volume, setVolume] = useState<number>(() => {
    const stored = localStorage.getItem('onair.volume')
    if (stored === null) return 0.8
    const parsed = parseFloat(stored)
    return isNaN(parsed) ? 0.8 : parsed
  })

  const [muted, setMuted] = useState<boolean>(() => {
    return localStorage.getItem('onair.muted') === 'true'
  })

  const [isFullscreen, setIsFullscreen] = useState(false)
  const prevVideoRef = useRef<HTMLVideoElement | null>(null)

  // Sync volume and mute to video element whenever the ref changes (important for dual-video swap)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video === prevVideoRef.current) return

    video.volume = volume
    video.muted = muted
    prevVideoRef.current = video
  })

  // Also sync on volume/mute state changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [volume, muted, videoRef])

  // Track fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value)
    setVolume(newVolume)
    localStorage.setItem('onair.volume', String(newVolume))
  }

  const handleMuteToggle = () => {
    const newMuted = !muted
    setMuted(newMuted)
    localStorage.setItem('onair.muted', String(newMuted))
  }

  const handleFullscreenToggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div
      className={styles.controls}
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}
    >
      {/* Volume slider */}
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={handleVolumeChange}
        className={styles.volumeSlider}
        aria-label="Volume"
      />

      {/* Mute button */}
      <button
        className={styles.iconButton}
        onClick={handleMuteToggle}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <VolumeX size={24} /> : <Volume2 size={24} />}
      </button>

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Game title */}
      {gameTitle && (
        <span className={styles.gameTitle}>{gameTitle}</span>
      )}

      {/* Game clock */}
      {gameClock && (
        <span className={styles.gameClock}>{gameClock}</span>
      )}

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Fullscreen button */}
      <button
        className={styles.iconButton}
        onClick={handleFullscreenToggle}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? <Minimize2 size={24} /> : <Maximize2 size={24} />}
      </button>
    </div>
  )
}
