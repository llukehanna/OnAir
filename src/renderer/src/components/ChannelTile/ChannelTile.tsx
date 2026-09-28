import React from 'react'
import { Play } from 'lucide-react'
import { channelHue, monogram } from '../../lib/guide'
import styles from './ChannelTile.module.css'

/** A channel's color, derived from its name: calm, distinct, stable. */
export function channelColor(name: string): { base: string; hi: string } {
  const h = channelHue(name)
  return { base: `hsl(${h} 30% 24%)`, hi: `hsl(${h} 38% 40%)` }
}

interface ChannelMarkProps {
  name: string
  size?: number
  className?: string
}

/** The monogram tile that stands in for a channel logo. */
export function ChannelMark({ name, size = 40, className }: ChannelMarkProps): React.JSX.Element {
  const { base, hi } = channelColor(name)
  const letters = monogram(name)
  // Scale type to the tile and to the letter count, so ESPN2 fits where CNN does.
  const fontSize = Math.round(size * (letters.length <= 2 ? 0.38 : letters.length === 3 ? 0.3 : 0.24))
  return (
    <span
      className={`${styles.mark} ${className ?? ''}`}
      style={{ width: size, height: size, fontSize, '--base': base, '--hi': hi } as React.CSSProperties}
      aria-hidden="true"
    >
      {letters}
    </span>
  )
}

interface ChannelTileProps {
  channel: Channel
  onTune: (channelId: string) => void
}

/** The guide's sticky channel cell: monogram, name, and how many sources carry it. */
export function ChannelTile({ channel, onTune }: ChannelTileProps): React.JSX.Element {
  return (
    <button
      className={styles.tile}
      onClick={() => onTune(channel.channelId)}
      aria-label={`Watch ${channel.name}`}
      title={`Watch ${channel.name}`}
    >
      <span className={styles.markWrap}>
        <ChannelMark name={channel.name} />
        <span className={styles.play} aria-hidden="true">
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </span>
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{channel.name}</span>
        <span className={styles.src}>
          {channel.sourceCount} src
        </span>
      </span>
    </button>
  )
}
