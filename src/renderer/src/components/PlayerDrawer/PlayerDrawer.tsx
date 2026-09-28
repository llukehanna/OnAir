import React from 'react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { TeamWash } from '../TeamWash/TeamWash'
import { hasScore, leader, leagueLabel, statusText, teamOf } from '../../lib/teams'
import { formatDuration, formatKickoff } from '../../lib/time'
import styles from './PlayerDrawer.module.css'

export interface StreamStats {
  source: string | null
  quality: string | null
  latency: number | null
  onAirSec: number
  failovers: number
}

interface PlayerDrawerProps {
  game: Game | undefined
  open: boolean
  /** Float over the picture (fullscreen) instead of taking width from it. */
  overlay: boolean
  stats: StreamStats
  children: React.ReactNode
}

export function PlayerDrawer({ game, open, overlay, stats, children }: PlayerDrawerProps): React.JSX.Element {
  const cls = [styles.drawer, open ? styles.open : '', overlay ? styles.overlay : ''].join(' ')
  return (
    <aside className={cls} aria-hidden={!open} aria-label="Game and stream details">
      <div className={styles.inner}>
        {game && <Scoreboard game={game} />}

        <section className={styles.section}>
          <h3 className={styles.heading}>Stream</h3>
          <dl className={styles.stats}>
            <Stat label="Source" value={stats.source ?? '—'} />
            <Stat label="Quality" value={stats.quality ?? 'Auto'} />
            <Stat label="Behind live" value={stats.latency !== null ? `${stats.latency.toFixed(1)}s` : '—'} />
            <Stat label="On air" value={stats.onAirSec > 0 ? formatDuration(stats.onAirSec) : '—'} />
          </dl>
          {stats.failovers > 0 && (
            <p className={styles.failovers}>
              Recovered from {stats.failovers} failure{stats.failovers === 1 ? '' : 's'} without dropping the picture.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>Sources</h3>
          {children}
        </section>

        <div className={styles.keys}>
          <span><kbd>Space</kbd>Pause</span>
          <span><kbd>M</kbd>Mute</span>
          <span><kbd>F</kbd>Full screen</span>
          <span><kbd>R</kbd>Details</span>
          <span><kbd>Esc</kbd>Back</span>
        </div>
      </div>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Scoreboard({ game }: { game: Game }): React.JSX.Element {
  const away = teamOf(game, 'away')
  const home = teamOf(game, 'home')
  const lead = leader(game)
  const started = game.status === 'LIVE' || game.status === 'RECENTLY_ENDED'
  const status = started ? statusText(game) : formatKickoff(game.startTime)
  const meta = [leagueLabel(game.league), game.network].filter(Boolean).join(' · ')

  return (
    <section className={styles.board}>
      <TeamWash game={game} intensity={0.55} className={styles.boardWash} />
      <div className={styles.boardGrid}>
        <div className={styles.side}>
          <TeamLogo team={away} size={56} plate />
          <span className={styles.abbr}>{away.shortName}</span>
          {away.record && <span className={styles.record}>{away.record}</span>}
        </div>
        <div className={styles.mid}>
          {started && hasScore(game) ? (
            <div className={styles.score}>
              <span className={lead === 'home' ? styles.trail : ''}>{away.score}</span>
              <span className={styles.dash}>–</span>
              <span className={lead === 'away' ? styles.trail : ''}>{home.score}</span>
            </div>
          ) : (
            <div className={styles.at}>at</div>
          )}
          <div className={`${styles.status} ${game.status === 'LIVE' ? styles.statusLive : ''}`}>{status}</div>
        </div>
        <div className={styles.side}>
          <TeamLogo team={home} size={56} plate />
          <span className={styles.abbr}>{home.shortName}</span>
          {home.record && <span className={styles.record}>{home.record}</span>}
        </div>
      </div>
      <div className={styles.boardMeta}>
        {meta}
        {game.venue && <span> · {game.venue}</span>}
      </div>
    </section>
  )
}
