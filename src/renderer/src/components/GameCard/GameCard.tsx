import React from 'react'
import styles from './GameCard.module.css'

interface GameCardProps {
  game: Game
  onClick: (gameId: string) => void
}

const leagueAccentMap: Record<LeagueId, string> = {
  nba: 'var(--accent-nba)',
  nfl: 'var(--accent-nfl)',
  cbb: 'var(--accent-cbb)',
  cfb: 'var(--accent-cfb)',
}

function TeamLogo({ name, league }: { name: string; league: LeagueId }): React.JSX.Element {
  const abbr = name.slice(0, 2).toUpperCase()
  return (
    <span
      className={styles.teamLogo}
      style={{ '--league-accent': leagueAccentMap[league] } as React.CSSProperties}
      aria-hidden="true"
    >
      {abbr}
    </span>
  )
}

function StatusBadge({ status }: { status: GameStatus }): React.JSX.Element {
  if (status === 'LIVE') {
    return (
      <span className={styles.badge} data-status="live">
        <span className={styles.liveDot} aria-hidden="true" />
        LIVE
      </span>
    )
  }
  if (status === 'STARTING_SOON') {
    return (
      <span className={styles.badge} data-status="soon">
        SOON
      </span>
    )
  }
  if (status === 'RECENTLY_ENDED') {
    return (
      <span className={styles.badge} data-status="ended">
        FINAL
      </span>
    )
  }
  return <></>
}

function formatStartTime(startTime: number): string {
  return new Date(startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Today 7:15 PM", "Tomorrow 1:00 PM", or "Sat, Sep 26 · 12:00 PM" further out. */
function formatScheduled(startTime: number, now: number = Date.now()): string {
  const start = new Date(startTime)
  const dayDiff = Math.round(
    (new Date(start).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000
  )
  const time = formatStartTime(startTime)
  if (dayDiff === 0) return `Today ${time}`
  if (dayDiff === 1) return `Tomorrow ${time}`
  const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} · ${time}`
}

export function GameCard({ game, onClick }: GameCardProps): React.JSX.Element {
  const { gameId, league, teamHome, teamAway, startTime, status } = game
  // Game carries no score data yet, so there is nothing to show in the score
  // column. Flip this back on once discovery stores scores.
  const showScores = false
  const isLive = status === 'LIVE'

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick(gameId)
    }
  }

  return (
    <div
      className={styles.card}
      data-league={league}
      data-status={status}
      role="button"
      tabIndex={0}
      aria-label={`${teamAway} at ${teamHome}, ${status}`}
      onClick={() => onClick(gameId)}
      onKeyDown={handleKeyDown}
    >
      {/* Top row: league badge + status badge */}
      <div className={styles.topRow}>
        <span
          className={styles.leagueBadge}
          style={{ color: leagueAccentMap[league] }}
        >
          {league.toUpperCase()}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Middle: team rows */}
      <div className={styles.teamsBlock}>
        {/* Away team row */}
        <div className={styles.teamRow}>
          <TeamLogo name={teamAway} league={league} />
          <span className={styles.teamName}>{teamAway}</span>
          {showScores && <span className={styles.score} style={{ color: leagueAccentMap[league] }}>—</span>}
        </div>

        {/* Separator */}
        <div className={styles.separator}>
          {showScores ? null : <span className={styles.vsText}>vs</span>}
        </div>

        {/* Home team row */}
        <div className={styles.teamRow}>
          <TeamLogo name={teamHome} league={league} />
          <span className={styles.teamName}>{teamHome}</span>
          {showScores && <span className={styles.score} style={{ color: leagueAccentMap[league] }}>—</span>}
        </div>
      </div>

      {/* Bottom row: clock/time */}
      <div className={styles.bottomRow}>
        <span className={styles.clockText}>
          {isLive && (
            <>
              <span className={styles.liveDotSmall} aria-hidden="true" />
              LIVE
            </>
          )}
          {status === 'STARTING_SOON' && formatStartTime(startTime)}
          {status === 'SCHEDULED' && formatScheduled(startTime)}
          {status === 'RECENTLY_ENDED' && 'Final'}
        </span>
      </div>
    </div>
  )
}

export function GameCardSkeleton(): React.JSX.Element {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skeletonTop} />
      <div className={styles.skeletonTeam} />
      <div className={styles.skeletonTeam} />
      <div className={styles.skeletonBottom} />
    </div>
  )
}
