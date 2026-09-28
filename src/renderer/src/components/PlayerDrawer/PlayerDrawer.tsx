import React from 'react'
import { Antenna, MonitorPlay, RadioTower, ShieldCheck, Timer, type LucideIcon } from 'lucide-react'
import { TeamLogo } from '../TeamLogo/TeamLogo'
import { TeamWash } from '../TeamWash/TeamWash'
import { ChannelMark, channelColor } from '../ChannelTile/ChannelTile'
import { hasScore, headlineText, leader, leagueLabel, statusText, teamOf } from '../../lib/teams'
import { categoryLabel, progressOf } from '../../lib/guide'
import { formatClock, formatDuration, formatKickoff } from '../../lib/time'
import styles from './PlayerDrawer.module.css'

export interface StreamStats {
  source: string | null
  quality: string | null
  latency: number | null
  onAirSec: number
  failovers: number
}

/** What a channel is showing, for the drawer's On now / Up next cards. */
export interface ChannelNow {
  name: string
  /** Undefined until the guide has loaded this channel. */
  channel: Channel | undefined
  now: GuideProgram | undefined
  next: GuideProgram | undefined
  /** The clock the cards measure progress against. */
  at: number
}

interface PlayerDrawerProps {
  /** The game on screen — directly, or the one a channel is carrying. */
  game: Game | undefined
  /** Set when a channel is tuned. */
  channel?: ChannelNow
  open: boolean
  /** Float over the picture (fullscreen) instead of taking width from it. */
  overlay: boolean
  stats: StreamStats
  children: React.ReactNode
}

export function PlayerDrawer({ game, channel, open, overlay, stats, children }: PlayerDrawerProps): React.JSX.Element {
  const cls = [styles.drawer, open ? styles.open : '', overlay ? styles.overlay : ''].join(' ')
  return (
    <aside className={cls} aria-hidden={!open} aria-label={channel ? 'Channel and stream details' : 'Game and stream details'}>
      <div className={styles.inner}>
        {game ? <Scoreboard game={game} /> : channel && <ChannelHeader info={channel} />}

        {channel && (
          <section className={styles.section}>
            {/* A game's scoreboard already says what's on; don't repeat it as a card. */}
            {!game && (
              <>
                <h3 className={styles.heading}>On now</h3>
                {channel.now ? (
                  <ProgramCard program={channel.now} at={channel.at} current />
                ) : (
                  <div className={styles.program}>
                    <span className={styles.programTitle}>Live</span>
                    <span className={styles.programSub}>No listings for this channel</span>
                  </div>
                )}
              </>
            )}
            {channel.next && (
              <>
                <h3 className={`${styles.heading} ${!game ? styles.headingGap : ''}`}>Up next</h3>
                <ProgramCard program={channel.next} at={channel.at} />
              </>
            )}
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.heading}>Stream</h3>
          <dl className={styles.stats}>
            <Stat icon={Antenna} label="Source" value={stats.source ?? '—'} />
            <Stat icon={MonitorPlay} label="Quality" value={stats.quality ?? 'Auto'} />
            <Stat icon={Timer} label="Behind live" value={stats.latency !== null ? `${stats.latency.toFixed(1)}s` : '—'} />
            <Stat icon={RadioTower} label="On air" value={stats.onAirSec > 0 ? formatDuration(stats.onAirSec) : '—'} />
          </dl>
          {stats.failovers > 0 && (
            <p className={styles.failovers}>
              <ShieldCheck size={15} strokeWidth={2} className={styles.failoversIcon} aria-hidden="true" />
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

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.stat}>
      <dt>
        <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}

function ChannelHeader({ info }: { info: ChannelNow }): React.JSX.Element {
  const { hi } = channelColor(info.name)
  const meta = info.channel
    ? [categoryLabel(info.channel.category), `${info.channel.sourceCount} source${info.channel.sourceCount === 1 ? '' : 's'}`].join(' · ')
    : 'Live channel'
  return (
    <section className={styles.chanHead}>
      <div className={styles.chanWash} style={{ '--hue': hi } as React.CSSProperties} aria-hidden="true" />
      <ChannelMark name={info.name} size={56} />
      <div className={styles.chanText}>
        <span className={styles.chanName}>{info.name}</span>
        <span className={styles.chanMeta}>{meta}</span>
      </div>
    </section>
  )
}

function ProgramCard({ program, at, current = false }: { program: GuideProgram; at: number; current?: boolean }): React.JSX.Element {
  const start = formatClock(program.start)
  const end = formatClock(program.end)
  const minsLeft = Math.max(0, Math.round((program.end - at) / 60_000))
  return (
    <div className={styles.program}>
      <span className={styles.programTitle}>{program.title}</span>
      {program.subtitle && <span className={styles.programSub}>{program.subtitle}</span>}
      {current ? (
        <div className={styles.programClock}>
          <span className={styles.progress} aria-hidden="true">
            <span className={styles.progressFill} style={{ width: `${progressOf(program, at) * 100}%` }} />
          </span>
          <span className={styles.programTime}>{program.end > at ? `${minsLeft} min left` : `Ran to ${end}`}</span>
        </div>
      ) : (
        <span className={styles.programTime}>
          {start} – {end}
        </span>
      )}
    </div>
  )
}

function Scoreboard({ game }: { game: Game }): React.JSX.Element {
  const away = teamOf(game, 'away')
  const home = teamOf(game, 'home')
  const lead = leader(game)
  const started = game.status === 'LIVE' || game.status === 'RECENTLY_ENDED'
  const status = started ? statusText(game) : formatKickoff(game.startTime)
  const meta = [leagueLabel(game.league), headlineText(game), game.network].filter(Boolean).join(' · ')

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
