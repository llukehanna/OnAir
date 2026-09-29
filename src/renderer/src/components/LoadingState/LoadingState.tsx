import React from 'react'
import {
  CalendarX,
  KeyRound,
  ListVideo,
  MonitorX,
  OctagonX,
  RotateCw,
  SearchX,
  Timer,
  TriangleAlert,
  Unplug,
  VideoOff,
  type LucideIcon,
} from 'lucide-react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { TeamWash } from '../TeamWash/TeamWash'
import { matchupLabel, teamOf } from '../../lib/teams'
import styles from './LoadingState.module.css'

interface LoadingStateProps {
  game: Game | undefined
  /** What's being tuned, when it isn't (only) a game — a channel's name. */
  title?: string
  /** Stands in for the team logos when there's no game, e.g. a channel's mark. */
  art?: React.ReactNode
}

export function LoadingState({ game, title, art }: LoadingStateProps): React.JSX.Element {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <TeamWash game={game} intensity={0.7} />
      <div className={styles.body}>
        {game ? (
          <div className={styles.logos}>
            <TeamLogo team={teamOf(game, 'away')} size={88} plate />
            <span className={styles.at}>at</span>
            <TeamLogo team={teamOf(game, 'home')} size={88} plate />
          </div>
        ) : (
          art && <div className={styles.logos}>{art}</div>
        )}
        <p className={styles.heading}>Finding the best stream</p>
        <p className={styles.sub}>{title ?? (game ? matchupLabel(game) : 'Loading game')}</p>
        <div className={styles.track} aria-hidden="true">
          <span className={styles.bar} />
        </div>
      </div>
    </div>
  )
}

interface AllSourcesFailedProps {
  game: Game | undefined
  /** Names what failed when it isn't a game, e.g. a channel. */
  title?: string
  /** A channel reads "this channel" where a game reads "this game". */
  kind?: 'game' | 'channel'
  onRetry: () => void
  /** Omit when no source has this game — the drawer would only say so. */
  onPickSource?: () => void
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
function headingFor(reason: string | null | undefined, kind: 'game' | 'channel'): string {
  switch (reason) {
    case 'all_sources_failed':
    case 'all_probes_failed':
      return 'Every source failed'
    case 'no_candidates':
      return `No stream found for this ${kind}`
    case 'game_not_found':
      return `That ${kind} is no longer available`
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

/** A glyph for the same reasons headingFor names, so the card reads at a glance. */
function iconFor(reason: string | null | undefined): LucideIcon {
  switch (reason) {
    case 'all_sources_failed':
    case 'all_probes_failed':
      return OctagonX
    case 'no_candidates':
      return SearchX
    case 'game_not_found':
      return CalendarX
    case 'token_expired':
    case 'forbidden':
      return KeyRound
    case 'source_gone':
      return Unplug
    case 'timeout':
      return Timer
    case 'off_air':
      return VideoOff
    case 'media_error':
    case 'hls_not_supported':
    case 'no_video_element':
      return MonitorX
    default:
      return TriangleAlert
  }
}

export function AllSourcesFailed({
  game,
  title,
  kind = 'game',
  onRetry,
  onPickSource,
  onBack,
  onOpenDiagnostics,
  reason,
}: AllSourcesFailedProps): React.JSX.Element {
  const ReasonIcon = iconFor(reason)
  return (
    <div className={styles.overlay} role="alert">
      <TeamWash game={game} intensity={0.35} />
      <div className={styles.card}>
        <span className={styles.reasonIcon} aria-hidden="true">
          <ReasonIcon size={22} strokeWidth={1.8} />
        </span>
        <p className={styles.cardHeading}>{headingFor(reason, kind)}</p>
        {(title || game) && <p className={styles.cardSub}>{title ?? (game ? matchupLabel(game) : '')}</p>}
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onRetry}>
            <RotateCw size={15} strokeWidth={2.2} />
            Try again
          </button>
          {onPickSource && (
            <button className={styles.secondary} onClick={onPickSource}>
              <ListVideo size={15} strokeWidth={2.2} />
              Pick a source
            </button>
          )}
        </div>
        <div className={styles.links}>
          <button className={styles.link} onClick={onBack}>{kind === 'channel' ? 'Back to guide' : 'Back to games'}</button>
          <span className={styles.sep} aria-hidden="true">·</span>
          <button className={styles.link} onClick={onOpenDiagnostics}>View diagnostics</button>
        </div>
      </div>
    </div>
  )
}
