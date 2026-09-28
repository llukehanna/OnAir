import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Row.module.css'

interface RowProps {
  title: string
  count?: number
  /** Dim the whole row, e.g. games that already ended. */
  muted?: boolean
  children: React.ReactNode
}

/** A titled horizontal shelf that scrolls by page, with arrows on hover. */
export function Row({ title, count, muted = false, children }: RowProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    })
  }, [])

  useEffect(() => {
    measure()
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, children])

  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className={`${styles.row} ${muted ? styles.muted : ''}`}>
      <h2 className={styles.title}>
        {title}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h2>
      <div className={styles.viewport}>
        <div
          className={`${styles.scroller} ${edges.start ? '' : styles.fadeStart} ${edges.end ? '' : styles.fadeEnd}`}
          ref={scrollerRef}
          onScroll={measure}
        >
          {children}
        </div>
        {!edges.start && (
          <button className={`${styles.arrow} ${styles.arrowPrev}`} onClick={() => page(-1)} aria-label={`Scroll ${title} back`}>
            <ChevronLeft size={20} />
          </button>
        )}
        {!edges.end && (
          <button className={`${styles.arrow} ${styles.arrowNext}`} onClick={() => page(1)} aria-label={`Scroll ${title} forward`}>
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </section>
  )
}
