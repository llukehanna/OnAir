import React from 'react'
import { Play } from 'lucide-react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { hasScore, leader, leagueShort, statusText, teamColor, teamOf } from '../../lib/teams'
import { countdown, formatKickoff } from '../../lib/time'
import styles from './GameTile.module.css'

interface GameTileProps {
  game: Game
  onWatch: (gameId: string) => void
  size?: 'lg' | 'md'
}

function subline(game: Game): string {
  switch (game.status) {
    case 'LIVE':
    case 'RECENTLY_ENDED':
      return [statusText(game), game.network].filter(Boolean).join(' · ')
    case 'STARTING_SOON':
      return [countdown(game.startTime), game.network].filter(Boolean).join(' · ')
    default:
      return [formatKickoff(game.startTime), game.network].filter(Boolean).join(' · ')
  }
}

export function GameTile({ game, onWatch, size = 'md' }: GameTileProps): React.JSX.Element {
  const away = teamOf(game, 'away')
  const home = teamOf(game, 'home')
  const lead = leader(game)
  const isLive = game.status === 'LIVE'
  const showScore = hasScore(game) && (isLive || game.status === 'RECENTLY_ENDED')
  const sub = subline(game)
  const logoSize = size === 'lg' ? 60 : 46

  return (
    <button
      className={`${styles.tile} ${styles[size]}`}
      style={{ '--away': teamColor(away), '--home': teamColor(home) } as React.CSSProperties}
      onClick={() => onWatch(game.gameId)}
      aria-label={`${away.shortName} at ${home.shortName}${isLive ? ', live' : ''}${sub ? `, ${sub}` : ''}`}
    >
      <span className={styles.bg} aria-hidden="true" />

      <span className={styles.top}>
        {isLive ? (
          <span className={styles.live}><span className={styles.liveDot} />Live</span>
        ) : (
          <span />
        )}
        <span className={styles.league}>{leagueShort(game.league)}</span>
      </span>

      <span className={styles.stage}>
        <TeamLogo team={away} size={logoSize} plate />
        {showScore ? (
          <span className={styles.score}>
            <span className={lead === 'home' ? styles.trail : ''}>{away.score}</span>
            <span className={styles.dash}>–</span>
            <span className={lead === 'away' ? styles.trail : ''}>{home.score}</span>
          </span>
        ) : (
          <span className={styles.at}>at</span>
        )}
        <TeamLogo team={home} size={logoSize} plate />
      </span>

      <span className={styles.caption}>
        <span className={styles.names}>{away.shortName} <span className={styles.atSmall}>at</span> {home.shortName}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>

      <span className={styles.play} aria-hidden="true">
        <Play size={18} fill="currentColor" strokeWidth={0} />
      </span>
    </button>
  )
}

export function GameTileSkeleton({ size = 'md' }: { size?: 'lg' | 'md' }): React.JSX.Element {
  return <span className={`${styles.skeleton} ${styles[size]}`} aria-hidden="true" />
}
