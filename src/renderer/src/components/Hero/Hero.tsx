import React, { useEffect, useState } from 'react'
import { Clock3, Play } from 'lucide-react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { TeamWash } from '../TeamWash/TeamWash'
import { hasScore, leader, leagueLabel, statusText, teamOf } from '../../lib/teams'
import { countdown, formatClock, formatKickoff } from '../../lib/time'
import styles from './Hero.module.css'

interface HeroProps {
  /** Featured games; the first is shown first. More than one enables the pager. */
  games: Game[]
  onWatch: (gameId: string) => void
}

const ADVANCE_MS = 8000

export function Hero({ games, onWatch }: HeroProps): React.JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = games.length
  const current = games[Math.min(index, count - 1)]

  // Keep the index valid as games drop off the featured list.
  useEffect(() => {
    if (index >= count) setIndex(0)
  }, [count, index])

  useEffect(() => {
    if (count < 2 || paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearTimeout(t)
  }, [index, count, paused])

  if (!current) return null

  const away = teamOf(current, 'away')
  const home = teamOf(current, 'home')
  const lead = leader(current)
  const isLive = current.status === 'LIVE'
  const scored = hasScore(current) && current.status !== 'SCHEDULED' && current.status !== 'STARTING_SOON'
  const meta = [leagueLabel(current.league), current.venue].filter(Boolean).join(' · ')

  let pill: string
  if (isLive) pill = [statusText(current), current.network].filter(Boolean).join(' · ')
  else if (current.status === 'RECENTLY_ENDED') pill = [statusText(current), current.network].filter(Boolean).join(' · ')
  else pill = [countdown(current.startTime), current.network].filter(Boolean).join(' · ')

  return (
    <section
      className={styles.hero}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Featured game"
    >
      {games.map((g, i) => (
        <TeamWash key={g.gameId} game={g} intensity={i === index ? 0.9 : 0} />
      ))}

      <div className={styles.content} key={current.gameId}>
        <div className={styles.meta}>{meta}</div>

        <div className={styles.matchup}>
          <div className={styles.team}>
            <TeamLogo team={away} size={120} plate />
            <div className={styles.teamText}>
              <div className={`${styles.teamName} ${lead === 'home' ? styles.trail : ''}`}>{away.shortName}</div>
              <div className={styles.teamSub}>{[away.record, 'Away'].filter(Boolean).join(' · ')}</div>
            </div>
          </div>

          <div className={styles.center}>
            {scored ? (
              <div className={styles.score}>
                <span className={lead === 'home' ? styles.trail : ''}>{away.score}</span>
                <span className={styles.dash}>–</span>
                <span className={lead === 'away' ? styles.trail : ''}>{home.score}</span>
              </div>
            ) : (
              <div className={styles.kickoff}>
                <span className={styles.kickoffDay}>{formatKickoff(current.startTime).replace(formatClock(current.startTime), '').trim() || 'Today'}</span>
                {formatClock(current.startTime)}
              </div>
            )}
            <div className={styles.pill}>
              {isLive && (
                <>
                  <span className={styles.liveDot} aria-hidden="true" />
                  <span className={styles.liveWord}>Live</span>
                </>
              )}
              {!isLive && current.status !== 'RECENTLY_ENDED' && (
                <Clock3 size={14} strokeWidth={2.2} className={styles.pillIcon} aria-hidden="true" />
              )}
              {pill}
            </div>
          </div>

          <div className={`${styles.team} ${styles.teamHome}`}>
            <div className={styles.teamText}>
              <div className={`${styles.teamName} ${lead === 'away' ? styles.trail : ''}`}>{home.shortName}</div>
              <div className={styles.teamSub}>{[home.record, 'Home'].filter(Boolean).join(' · ')}</div>
            </div>
            <TeamLogo team={home} size={120} plate />
          </div>
        </div>

        <div className={styles.actions}>
          <button className={styles.watch} onClick={() => onWatch(current.gameId)}>
            <Play size={16} fill="currentColor" strokeWidth={0} />
            {isLive ? 'Watch live' : 'Watch'}
          </button>
        </div>
      </div>

      {count > 1 && (
        <div className={styles.pager} role="tablist" aria-label="Featured games">
          {games.map((g, i) => (
            <button
              key={g.gameId}
              role="tab"
              aria-selected={i === index}
              aria-label={`${teamOf(g, 'away').shortName} at ${teamOf(g, 'home').shortName}`}
              className={`${styles.dot} ${i === index ? styles.dotOn : ''}`}
              onClick={() => setIndex(i)}
            >
              {i === index && !paused && <span className={styles.dotFill} style={{ animationDuration: `${ADVANCE_MS}ms` }} />}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function HeroSkeleton(): React.JSX.Element {
  return (
    <section className={`${styles.hero} ${styles.skeleton}`} aria-hidden="true">
      <div className={styles.content}>
        <div className={styles.matchup}>
          <div className={styles.team}><span className={styles.skelCircle} /><span className={styles.skelLine} /></div>
          <div className={styles.center}><span className={styles.skelScore} /></div>
          <div className={`${styles.team} ${styles.teamHome}`}><span className={styles.skelLine} /><span className={styles.skelCircle} /></div>
        </div>
      </div>
    </section>
  )
}
