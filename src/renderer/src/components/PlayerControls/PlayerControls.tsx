import React from 'react'
import { Maximize, Minimize, Pause, Play, PanelRight, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { PlayerMedia } from '../../hooks/usePlayerMedia'
import styles from './PlayerControls.module.css'

interface PlayerControlsProps {
  media: PlayerMedia
  liveLatency: number | null
  isFullscreen: boolean
  onToggleFullscreen: () => void
  drawerOpen: boolean
  onToggleDrawer: () => void
}

export function PlayerControls({
  media,
  liveLatency,
  isFullscreen,
  onToggleFullscreen,
  drawerOpen,
  onToggleDrawer,
}: PlayerControlsProps): React.JSX.Element {
  const { volume, muted, paused, behindBy } = media
  const atEdge = behindBy === 0 && !paused
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const fill = `${Math.round((muted ? 0 : volume) * 100)}%`

  return (
    <div className={styles.controls}>
      <button className={styles.icon} onClick={media.togglePause} aria-label={paused ? 'Play' : 'Pause'} title={paused ? 'Play (Space)' : 'Pause (Space)'}>
        {paused ? <Play size={20} fill="currentColor" strokeWidth={0} /> : <Pause size={20} fill="currentColor" strokeWidth={0} />}
      </button>

      <div className={styles.volume}>
        <button className={styles.icon} onClick={media.toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute (M)">
          <VolumeIcon size={20} strokeWidth={1.9} />
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          onChange={(e) => media.setVolume(parseFloat(e.target.value))}
          className={styles.slider}
          style={{ '--fill': fill } as React.CSSProperties}
          aria-label="Volume"
        />
      </div>

      <button
        className={`${styles.live} ${atEdge ? styles.liveOn : ''}`}
        onClick={media.goLive}
        disabled={atEdge}
        aria-label={atEdge ? 'At live' : 'Jump to live'}
        title={atEdge ? undefined : 'Jump to live'}
      >
        <span className={styles.liveDot} aria-hidden="true" />
        {atEdge ? 'LIVE' : 'GO LIVE'}
      </button>

      {liveLatency !== null && (
        <span className={styles.latency} title="How far this stream runs behind the live broadcast">
          {liveLatency.toFixed(1)}s behind
        </span>
      )}

      <div className={styles.spacer} />

      <button
        className={`${styles.icon} ${drawerOpen ? styles.iconOn : ''}`}
        onClick={onToggleDrawer}
        aria-label={drawerOpen ? 'Hide details' : 'Show details'}
        aria-pressed={drawerOpen}
        title="Details (R)"
      >
        <PanelRight size={19} strokeWidth={1.9} />
      </button>
      <button className={styles.icon} onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)">
        {isFullscreen ? <Minimize size={19} strokeWidth={1.9} /> : <Maximize size={19} strokeWidth={1.9} />}
      </button>
    </div>
  )
}
