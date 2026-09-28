import React, { useState } from 'react'
import { darkLogo, teamColor } from '../../lib/teams'
import styles from './TeamLogo.module.css'

interface TeamLogoProps {
  team: TeamInfo
  size: number
  /**
   * Seat the logo on a soft dark plate. Use it wherever the logo sits on team
   * color, so a green logo on a green tile still reads.
   */
  plate?: boolean
  className?: string
}

/** Tries ESPN's dark-background logo, then the standard one, then a monogram. */
export function TeamLogo({ team, size, plate = false, className }: TeamLogoProps): React.JSX.Element {
  const candidates = [darkLogo(team.logo), team.logo].filter((u): u is string => !!u)
  const [attempt, setAttempt] = useState(0)
  const src = candidates[attempt]

  const box: React.CSSProperties = { width: size, height: size }

  return (
    <span className={`${styles.wrap} ${plate ? styles.plate : ''} ${className ?? ''}`} style={box} aria-hidden="true">
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          className={styles.img}
          draggable={false}
          onError={() => setAttempt((a) => a + 1)}
        />
      ) : (
        <span
          className={styles.monogram}
          style={{ background: teamColor(team), fontSize: Math.round(size * 0.32) }}
        >
          {team.abbr}
        </span>
      )}
    </span>
  )
}
