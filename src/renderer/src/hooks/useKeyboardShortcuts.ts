import React, { useEffect } from 'react'

interface KeyboardShortcutOptions {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  enabled: boolean // only active when Player screen is showing
}

/**
 * Transport keys for the active video. Fullscreen, mute, the details drawer and
 * Escape belong to PlayerScreen, which owns that state.
 */
export function useKeyboardShortcuts({ videoRef, enabled }: KeyboardShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Suppress when input/textarea/select is focused
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      const video = videoRef.current
      if (!video) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (video.paused) video.play().catch(() => {})
          else video.pause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          video.currentTime = Math.max(0, video.currentTime - 10)
          break
        case 'ArrowRight':
          e.preventDefault()
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [videoRef, enabled])
}
