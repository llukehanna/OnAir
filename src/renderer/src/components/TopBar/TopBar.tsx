import React, { useLayoutEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { useGames } from '../../context/GamesContext'
import { LEAGUE_ORDER, leagueShort } from '../../lib/teams'
import styles from './TopBar.module.css'

interface TopBarProps {
  onDiagnostics: boolean
  league: LeagueId | null
  onLeague: (league: LeagueId | null) => void
  onOpenDiagnostics: () => void
  onHome: () => void
  /** Content is scrolled beneath the bar; show the frosted backing. */
  scrolled: boolean
}

export function TopBar({
  onDiagnostics,
  league,
  onLeague,
  onOpenDiagnostics,
  onHome,
  scrolled,
}: TopBarProps): React.JSX.Element {
  const { games } = useGames()

  // Only leagues with something on the schedule get a segment.
  const present = new Set(games.map((g) => g.league))
  const leagues = LEAGUE_ORDER.filter((l) => present.has(l))
  const live = new Set(games.filter((g) => g.status === 'LIVE').map((g) => g.league))
  const anyLive = live.size > 0

  const segments: Array<{ id: LeagueId | null; label: string; live: boolean }> = [
    { id: null, label: 'All', live: false },
    ...leagues.map((l) => ({ id: l, label: leagueShort(l), live: live.has(l) })),
  ]

  // Slide a single white pill under the selected segment instead of
  // repainting each button, so switching leagues feels physical.
  const segRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const selectedIndex = onDiagnostics ? -1 : segments.findIndex((s) => s.id === league)

  useLayoutEffect(() => {
    const el = segRef.current?.querySelectorAll<HTMLButtonElement>('button')[selectedIndex]
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
  }, [selectedIndex, segments.length])

  return (
    <header className={`${styles.bar} ${scrolled ? styles.scrolled : ''}`}>
      <button className={styles.brand} onClick={onHome} aria-label="OnAir home">
        <span className={`${styles.tally} ${anyLive ? styles.tallyLive : ''}`} aria-hidden="true" />
        OnAir
      </button>

      <div className={styles.segments} ref={segRef} role="tablist" aria-label="League">
        {pill && (
          <span className={styles.pill} style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
        )}
        {segments.map((s, i) => (
          <button
            key={s.label}
            role="tab"
            aria-selected={i === selectedIndex}
            className={`${styles.segment} ${i === selectedIndex ? styles.segmentOn : ''}`}
            onClick={() => onLeague(s.id)}
          >
            {s.label}
            {s.live && <span className={styles.liveDot} aria-label="live" />}
          </button>
        ))}
      </div>

      <div className={styles.spacer} />

      <button
        className={`${styles.iconButton} ${onDiagnostics ? styles.iconButtonOn : ''}`}
        onClick={onOpenDiagnostics}
        aria-label="Diagnostics"
        aria-current={onDiagnostics ? 'page' : undefined}
        title="Diagnostics"
      >
        <Activity size={17} strokeWidth={1.8} />
      </button>
    </header>
  )
}
