import React from 'react'
import styles from './LoadingState.module.css'

interface LoadingStateProps {
  game: Game | undefined
}

export function LoadingState({ game }: LoadingStateProps): React.JSX.Element {
  const leagueClass = game?.league ? styles[`accent_${game.league}`] : ''

  return (
    <div className={styles.overlay}>
      <p className={styles.heading}>Finding stream...</p>

      {game ? (
        <>
          <p className={styles.gameTitle}>
            {game.teamAway} vs {game.teamHome}
          </p>
          <p className={styles.gameMeta}>
            {game.league.toUpperCase()} · {game.status}
          </p>
        </>
      ) : (
        <p className={styles.gameTitle}>Loading game info...</p>
      )}

      <div className={styles.progressTrack}>
        <div className={`${styles.progressBar} ${leagueClass}`} />
      </div>

      <p className={styles.sourcesText}>Checking 3 sources</p>
    </div>
  )
}

interface AllSourcesFailedProps {
  game: Game | undefined
  onRetry: () => void
  onPickSource: () => void
  onBack: () => void
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
function headingFor(reason: string | null | undefined, game: Game | undefined): string {
  const suffix = game ? ` for ${game.teamAway} vs ${game.teamHome}` : ''
  switch (reason) {
    case 'all_sources_failed':
    case 'all_probes_failed':
      return `Every source failed${suffix}`
    case 'no_candidates':
      return `No stream found${suffix}`
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
      return `Playback stopped${suffix}`
  }
}

export function AllSourcesFailed({
  game,
  onRetry,
  onPickSource,
  onBack,
  reason,
}: AllSourcesFailedProps): React.JSX.Element {
  const accentClass = game?.league ? styles[`accentBorder_${game.league}`] : ''

  return (
    <div className={styles.overlay}>
      <p className={styles.heading}>{headingFor(reason, game)}</p>

      <div className={styles.buttonRow}>
        <button
          className={`${styles.retryButton} ${accentClass}`}
          onClick={onRetry}
        >
          Retry Stream
        </button>
        <button
          className={styles.pickSourceButton}
          onClick={onPickSource}
        >
          Pick a Source
        </button>
      </div>

      <span className={styles.diagnosticsLink}>
        View details in Diagnostics &rarr;
      </span>

      <button className={styles.backLink} onClick={onBack}>
        &larr; Back to games
      </button>
    </div>
  )
}
