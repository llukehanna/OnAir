import React, { useMemo, useState } from 'react'
import { RotateCw, SearchX } from 'lucide-react'
import { useGames } from '../../context/GamesContext'
import { useGuide } from '../../context/GuideContext'
import { useNow } from '../../hooks/useNow'
import { ChannelTile } from '../../components/ChannelTile/ChannelTile'
import {
  CHANNEL_COL_W,
  GUIDE_HOURS,
  PX_PER_HOUR,
  ROW_H,
  categoryLabel,
  filterChannels,
  guideWindow,
  liveChannelIds,
  onNow,
  placeBlock,
  programsFor,
  slotTicks,
  sortChannels,
  xFor,
  type GuideCategory,
  type GuideWindow,
} from '../../lib/guide'
import { hasScore, statusText, teamColor, teamOf } from '../../lib/teams'
import { formatClock } from '../../lib/time'
import styles from './GuideScreen.module.css'

interface GuideScreenProps {
  category: GuideCategory
  query: string
  onTune: (channelId: string) => void
  onClearFilters: () => void
}

/** The now-line moves every 30 seconds; nothing in the grid needs finer time. */
const TICK_MS = 30_000
const LANE_W = GUIDE_HOURS * PX_PER_HOUR

export function GuideScreen({ category, query, onTune, onClearFilters }: GuideScreenProps): React.JSX.Element {
  const { channels, programs, loading, error, refreshing, refresh } = useGuide()
  const { games } = useGames()
  const now = useNow(TICK_MS)
  const win = guideWindow(now)
  const [scrolledX, setScrolledX] = useState(false)

  const gamesById = useMemo(() => new Map(games.map((g) => [g.gameId, g])), [games])
  const liveGameIds = useMemo(() => new Set(games.filter((g) => g.status === 'LIVE').map((g) => g.gameId)), [games])

  const rows = useMemo(() => {
    const live = liveChannelIds(programs, liveGameIds)
    return sortChannels(filterChannels(channels, category, query), live)
  }, [channels, programs, liveGameIds, category, query])

  if (loading) return <GuideSkeleton />

  if (channels.length === 0) {
    return (
      <Empty
        title={error ? 'Can’t load the guide' : 'No channels found yet'}
        text={
          error
            ? 'Something went wrong reading the channel list. Try again in a moment.'
            : 'OnAir checks your sources for 24/7 channels every half hour. Refresh to look now.'
        }
        action={
          <button className={styles.primary} onClick={() => void refresh()} disabled={refreshing}>
            <RotateCw size={15} strokeWidth={2.2} className={refreshing ? styles.spin : ''} />
            {refreshing ? 'Looking for channels' : 'Refresh'}
          </button>
        }
      />
    )
  }

  if (rows.length === 0) {
    const q = query.trim()
    return (
      <Empty
        icon={<SearchX size={20} strokeWidth={1.8} />}
        title={q ? `No channels match “${q}”` : `No ${categoryLabel(category)} channels`}
        text={
          q && category !== 'all'
            ? `Searching ${categoryLabel(category)} only. Clear the filters to search every channel.`
            : q
              ? 'Try another name. Channels appear here as your sources start carrying them.'
              : 'Channels appear here as your sources start carrying them.'
        }
        action={
          <button className={styles.secondary} onClick={onClearFilters}>
            Clear filters
          </button>
        }
      />
    )
  }

  const nowX = xFor(now, win.start)

  return (
    <div className={styles.screen}>
      <div
        className={`${styles.scroller} ${scrolledX ? styles.scrolledX : ''}`}
        onScroll={(e) => setScrolledX(e.currentTarget.scrollLeft > 0)}
      >
        <div className={styles.grid} style={{ width: CHANNEL_COL_W + LANE_W }}>
          <Ruler win={win} nowX={nowX} count={rows.length} now={now} />

          <div className={styles.body} role="grid" aria-label="Channel guide" aria-rowcount={rows.length}>
            <span className={styles.nowLine} style={{ left: CHANNEL_COL_W + nowX }} aria-hidden="true" />
            {rows.map((channel) => (
              <div
                key={channel.channelId}
                className={styles.row}
                role="row"
                style={{ height: ROW_H }}
              >
                <div className={styles.channelCell} role="rowheader" style={{ width: CHANNEL_COL_W }}>
                  <ChannelTile channel={channel} onTune={onTune} />
                </div>
                <Lane
                  channel={channel}
                  programs={programsFor(programs, channel.channelId)}
                  win={win}
                  now={now}
                  gamesById={gamesById}
                  liveGameIds={liveGameIds}
                  onTune={onTune}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Ruler -----------------------------------------------------------------

function Ruler({ win, nowX, count, now }: { win: GuideWindow; nowX: number; count: number; now: number }): React.JSX.Element {
  const day = new Date(now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div className={styles.ruler}>
      <div className={styles.corner} style={{ width: CHANNEL_COL_W }}>
        <span className={styles.cornerDay}>{day}</span>
        <span className={styles.cornerCount}>
          {count} channel{count === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.ticks} style={{ width: LANE_W }}>
        {slotTicks(win).map((t) => {
          const d = new Date(t)
          const onHour = d.getMinutes() === 0
          const midnight = onHour && d.getHours() === 0
          return (
            <span key={t} className={`${styles.tick} ${onHour ? styles.tickHour : ''}`} style={{ left: xFor(t, win.start) }}>
              {midnight ? d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' : ''}
              {onHour ? formatClock(t) : formatClock(t).replace(/\s?[AP]M$/, '')}
            </span>
          )
        })}
        <span className={styles.nowHead} style={{ left: nowX }} aria-hidden="true" />
      </div>
    </div>
  )
}

// --- Lane ------------------------------------------------------------------

interface LaneProps {
  channel: Channel
  programs: GuideProgram[]
  win: GuideWindow
  now: number
  gamesById: Map<string, Game>
  liveGameIds: Set<string>
  onTune: (channelId: string) => void
}

function Lane({ channel, programs, win, now, gamesById, liveGameIds, onTune }: LaneProps): React.JSX.Element {
  const placed = programs
    .map((p) => ({ program: p, at: placeBlock(p, win) }))
    .filter((b): b is { program: GuideProgram; at: NonNullable<ReturnType<typeof placeBlock>> } => b.at !== null)

  // Same rule as the player's "On now": a live game stays current through
  // overtime, past its listed end.
  const current = onNow(programs, channel.channelId, now, liveGameIds)

  return (
    <div className={styles.lane} role="gridcell" style={{ width: LANE_W }}>
      {placed.length === 0 ? (
        <button
          className={`${styles.block} ${styles.now}`}
          style={{ left: 0, width: LANE_W - 4 }}
          onClick={() => onTune(channel.channelId)}
          aria-label={`Watch ${channel.name}, live`}
        >
          <span className={styles.inner}>
            <span className={styles.title}>Live</span>
            <span className={styles.sub}>No listings for this channel</span>
          </span>
        </button>
      ) : (
        placed.map(({ program, at }) => (
          <Block
            key={`${program.start}-${program.title}`}
            program={program}
            left={at.left}
            width={at.width}
            state={program === current ? 'now' : program.end <= now ? 'past' : 'future'}
            game={program.gameId ? gamesById.get(program.gameId) : undefined}
            onTune={() => onTune(channel.channelId)}
          />
        ))
      )}
    </div>
  )
}

// --- Block -----------------------------------------------------------------

interface BlockProps {
  program: GuideProgram
  left: number
  width: number
  state: 'past' | 'now' | 'future'
  game: Game | undefined
  onTune: () => void
}

const timeRange = (p: GuideProgram) => `${formatClock(p.start).replace(/\s?[AP]M$/, '')} – ${formatClock(p.end)}`

function Block({ program, left, width, state, game, onTune }: BlockProps): React.JSX.Element {
  const live = game?.status === 'LIVE'
  const away = game ? teamOf(game, 'away') : null
  const home = game ? teamOf(game, 'home') : null

  const title =
    game && away && home ? (
      <span className={styles.title}>
        {live && <span className={styles.liveDot} aria-hidden="true" />}
        {hasScore(game) && (live || game.status === 'RECENTLY_ENDED') ? (
          <>
            {away.shortName} <span className={styles.score}>{away.score}</span>
            <span className={styles.dash}>–</span>
            <span className={styles.score}>{home.score}</span> {home.shortName}
          </>
        ) : (
          program.title
        )}
      </span>
    ) : (
      <span className={styles.title}>{program.title}</span>
    )

  const detail = live && game ? statusText(game) : program.subtitle

  const cls = [
    styles.block,
    styles[state],
    game ? styles.game : '',
    width < 56 ? styles.narrow : '',
  ].join(' ')
  const style = {
    left,
    // The block's 2px side margins come out of its slot.
    width: Math.max(0, width - 4),
    ...(away && home ? { '--away': teamColor(away), '--home': teamColor(home) } : {}),
  } as React.CSSProperties
  const label = `${program.title}${live ? ', live' : ''}, ${timeRange(program)}`

  const content = (
    <span className={styles.inner}>
      {title}
      {state === 'future' ? (
        // The time is one hover away, so the resting line can say what it is.
        <span className={styles.subSwap}>
          <span className={`${styles.sub} ${detail ? styles.rest : styles.mono}`}>{detail ?? timeRange(program)}</span>
          {detail && <span className={`${styles.sub} ${styles.hover} ${styles.mono}`}>{timeRange(program)}</span>}
        </span>
      ) : (
        <span className={`${styles.sub} ${detail ? '' : styles.mono}`}>{detail ?? `Until ${formatClock(program.end)}`}</span>
      )}
    </span>
  )

  if (state === 'now') {
    return (
      <button className={cls} style={style} onClick={onTune} aria-label={`Watch ${label}`}>
        {content}
      </button>
    )
  }
  return (
    <div className={cls} style={style} title={label} aria-label={label}>
      {content}
    </div>
  )
}

// --- Empty and loading -----------------------------------------------------

function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon?: React.ReactNode
  title: string
  text: string
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={styles.empty}>
      {icon ? <span className={styles.emptyIcon} aria-hidden="true">{icon}</span> : <span className={styles.emptyTally} aria-hidden="true" />}
      <h1 className={styles.emptyTitle}>{title}</h1>
      <p className={styles.emptyText}>{text}</p>
      <div className={styles.emptyAction}>{action}</div>
    </div>
  )
}

function GuideSkeleton(): React.JSX.Element {
  // Deterministic widths so the skeleton doesn't reshuffle on every render.
  const widths = [[300, 180, 420], [540, 240], [160, 360, 300], [720], [240, 240, 480], [420, 300], [360, 540]]
  return (
    <div className={styles.screen} aria-busy="true">
      <div className={styles.skeleton}>
        <div className={styles.skeletonRuler} />
        {widths.map((row, i) => (
          <div key={i} className={styles.skeletonRow} style={{ height: ROW_H }}>
            <span className={styles.skeletonChannel} style={{ width: CHANNEL_COL_W - 36 }} />
            {row.map((w, j) => (
              <span key={j} className={styles.skeletonBlock} style={{ width: w - 4 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
