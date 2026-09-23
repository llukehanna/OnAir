import React, { useState, useRef, useEffect } from 'react'
import styles from './FailoverToast.module.css'

interface ToastEntry {
  id: number
  sourceName: string
  dismissing: boolean
}

export function FailoverToast(): React.JSX.Element | null {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    // Timers are owned by the effect, not the event callback — a cleanup
    // returned from the callback would be discarded by onPlaybackEvent,
    // leaving timers to fire against an unmounted component.
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const unsub = window.onair.onPlaybackEvent((event) => {
      if (event.type !== 'source_switch') return

      const sourceName = (event.details?.sourceName as string) ?? 'Unknown'
      const id = nextId.current++

      setToasts((prev) => [...prev, { id, sourceName, dismissing: false }])

      // Start dismiss animation 200ms before removal
      timers.add(
        setTimeout(() => {
          setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t))
          )
        }, 2800)
      )

      // Auto-dismiss after 3 seconds
      timers.add(
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 3000)
      )
    })

    return () => {
      unsub()
      for (const t of timers) clearTimeout(t)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className={styles.toastContainer} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.dismissing ? styles.toastDismissing : ''}`}
          role="status"
        >
          Switching to {toast.sourceName}...
        </div>
      ))}
    </div>
  )
}
