import React from 'react'
import { teamColor, teamOf } from '../../lib/teams'
import styles from './TeamWash.module.css'

interface TeamWashProps {
  game: Game | undefined
  /** 0–1; how strongly the team colors show. */
  intensity?: number
  className?: string
}

/**
 * Two soft pools of team color, away on the left and home on the right,
 * fading into the canvas. The ambient light behind the hero, the loading
 * screen and the player drawer.
 */
export function TeamWash({ game, intensity = 0.8, className }: TeamWashProps): React.JSX.Element {
  const away = game ? teamColor(teamOf(game, 'away')) : '#2a2a30'
  const home = game ? teamColor(teamOf(game, 'home')) : '#1e1e24'
  return (
    <div
      className={`${styles.wash} ${className ?? ''}`}
      style={{ '--away': away, '--home': home, opacity: intensity } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className={styles.grain} />
    </div>
  )
}
