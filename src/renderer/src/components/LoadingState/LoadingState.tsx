import React from 'react'
import { RotateCw } from 'lucide-react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { TeamWash } from '../TeamWash/TeamWash'
import { matchupLabel, teamOf } from '../../lib/teams'
import styles from './LoadingState.module.css'

interface LoadingStateProps {
  game: Game | undefined
}

export function LoadingState({ game }: LoadingStateProps): React.JSX.Element {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <TeamWash game={game} intensity={0.7} />
      <div className={styles.body}>
        {game && (
          <div className={styles.logos}>
            <TeamLogo team={teamOf(game, 'away')} size={88} plate />
            <span className={styles.at}>at</span>
            <TeamLogo team={teamOf(game, 'home')} size={88} plate />
          </div>
        )}
        <p className={styles.heading}>Finding the best stream</p>
        <p className={styles.sub}>{game ? matchupLabel(game) : 'Loading game'}</p>
        <div className={styles.track} aria-hidden="true">
          <span className={styles.bar} />
        </div>
      </div>
    </div>
  )
}

interface AllSourcesFailedProps {
  game: Game | undefined
  onRetry: () => void
  onPickSource: () => void
  onBack: () => void
  onOpenDiagnostics: () => void
  /** Machine-readable reason from usePlayback. */
  reason?: string | null
}

/**
 * Says what actually happened.
 *
 * This overlay renders for every error state, so a fixed "no stream found"
 * misreports failures that never reached a source — an unsupported player or a
 * missing video element are local problems, and telling the user their sources
 * are exhausted sends them looking in the wrong place.
 */
function headingFor(reason: string | null | undefined): string {
  switch (reason) {
    case 'all_sources_failed':
    case 'all_probes_failed':
      return 'Every source failed'
    case 'no_candidates':
      return 'No stream found for this game'
    case 'game_not_found':
      return 'That game is no longer available'
    case 'token_expired':
    case 'forbidden':
      return 'The stream link expired and could not be renewed'
    case 'source_gone':
      return 'The source stopped carrying this stream'
    case 'timeout':
      return 'The source stopped responding'
    case 'off_air':
      return 'The source went off the air'
    case 'media_error':
      return 'The stream could not be decoded'
    case 'hls_not_supported':
      return 'This build cannot play HLS streams'
    case 'no_video_element':
      return 'The player failed to initialize'
    case 'ipc_error':
    case 'failover_failed':
      return 'Playback failed unexpectedly'
    default:
      return 'Playback stopped'
  }
}

export function AllSourcesFailed({
  game,
  onRetry,
  onPickSource,
  onBack,
  onOpenDiagnostics,
  reason,
}: AllSourcesFailedProps): React.JSX.Element {
  return (
    <div className={styles.overlay} role="alert">
      <TeamWash game={game} intensity={0.35} />
      <div className={styles.card}>
        <span className={styles.errorDot} aria-hidden="true" />
        <p className={styles.cardHeading}>{headingFor(reason)}</p>
        {game && <p className={styles.cardSub}>{matchupLabel(game)}</p>}
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onRetry}>
            <RotateCw size={15} strokeWidth={2.2} />
            Try again
          </button>
          <button className={styles.secondary} onClick={onPickSource}>Pick a source</button>
        </div>
        <div className={styles.links}>
          <button className={styles.link} onClick={onBack}>Back to games</button>
          <span className={styles.sep} aria-hidden="true">·</span>
          <button className={styles.link} onClick={onOpenDiagnostics}>View diagnostics</button>
        </div>
      </div>
    </div>
  )
}
