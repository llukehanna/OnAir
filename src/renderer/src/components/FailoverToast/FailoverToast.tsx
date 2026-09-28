import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import styles from './FailoverToast.module.css'

interface ToastEntry {
  id: number
  sourceName: string
  manual: boolean
  leaving: boolean
}

const SHOW_MS = 3200
const LEAVE_MS = 320

/** Announces every source switch; a failover the viewer never saw is still worth knowing about. */
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
      const sourceName = (event.details?.sourceName as string) ?? 'another source'
      const manual = event.details?.reason === 'user_selected'
      const id = nextId.current++

      // One at a time: a newer switch replaces the older notice.
      setToasts([{ id, sourceName, manual, leaving: false }])
      timers.add(setTimeout(() => setToasts((p) => p.map((t) => (t.id === id ? { ...t, leaving: true } : t))), SHOW_MS))
      timers.add(setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), SHOW_MS + LEAVE_MS))
    })

    return () => {
      unsub()
      for (const t of timers) clearTimeout(t)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className={styles.container} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.leaving ? styles.leaving : ''}`} role="status">
          <span className={styles.icon} aria-hidden="true"><ArrowLeftRight size={14} strokeWidth={2.2} /></span>
          <span>
            Switched to <b>{t.sourceName}</b>
          </span>
          {!t.manual && <span className={styles.note}>no interruption</span>}
        </div>
      ))}
    </div>
  )
}
