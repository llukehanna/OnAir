import React from 'react'
import { useGames } from '../../context/GamesContext'
import { Hero, HeroSkeleton } from '../../components/Hero/Hero'
import { Row } from '../../components/Row/Row'
import { GameTile, GameTileSkeleton } from '../../components/GameTile/GameTile'
import { dayBucket, formatKickoff } from '../../lib/time'
import { leagueLabel } from '../../lib/teams'
import styles from './HomeScreen.module.css'

interface HomeScreenProps {
  selectedLeague: LeagueId | null
  onGameClick: (gameId: string) => void
}

const byStart = (a: Game, b: Game) => a.startTime - b.startTime

/** Below this many upcoming games, day-by-day shelves are mostly empty; use one row. */
const SPLIT_BY_DAY_MIN = 9

/** What the hero features: every live game, else what's about to start, else the next one. */
function featuredGames(live: Game[], soon: Game[], scheduled: Game[]): Game[] {
  if (live.length > 0) return live.slice(0, 6)
  if (soon.length > 0) return soon.slice(0, 6)
  return scheduled.slice(0, 1)
}

export function HomeScreen({ selectedLeague, onGameClick }: HomeScreenProps): React.JSX.Element {
  const { games, loading, error } = useGames()

  const filtered = selectedLeague ? games.filter((g) => g.league === selectedLeague) : games
  const live = filtered.filter((g) => g.status === 'LIVE').sort(byStart)
  const soon = filtered.filter((g) => g.status === 'STARTING_SOON').sort(byStart)
  const scheduled = filtered.filter((g) => g.status === 'SCHEDULED').sort(byStart)
  const ended = filtered.filter((g) => g.status === 'RECENTLY_ENDED').sort((a, b) => b.startTime - a.startTime)

  const later = {
    today: scheduled.filter((g) => dayBucket(g.startTime) === 'today'),
    tomorrow: scheduled.filter((g) => dayBucket(g.startTime) === 'tomorrow'),
    week: scheduled.filter((g) => dayBucket(g.startTime) === 'week'),
    beyond: scheduled.filter((g) => dayBucket(g.startTime) === 'later'),
  }

  const featured = featuredGames(live, soon, scheduled)

  if (loading) {
    return (
      <div className={styles.container} aria-busy="true">
        <HeroSkeleton />
        {[0, 1].map((r) => (
          <div key={r} className={styles.skeletonRow}>
            <span className={styles.skeletonTitle} />
            <div className={styles.skeletonTiles}>
              {Array.from({ length: 5 }).map((_, i) => <GameTileSkeleton key={i} size={r === 0 ? 'lg' : 'md'} />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    const next = games.filter((g) => g.status === 'SCHEDULED').sort(byStart)[0]
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyTally} aria-hidden="true" />
          <h1 className={styles.emptyTitle}>
            {error ? 'Can’t reach the schedule' : selectedLeague ? `No ${leagueLabel(selectedLeague)} games right now` : 'Nothing on right now'}
          </h1>
          <p className={styles.emptyText}>
            {error
              ? 'OnAir will keep retrying in the background.'
              : next
                ? `Next up: ${next.teamAway} at ${next.teamHome}, ${formatKickoff(next.startTime)}.`
                : 'New games appear here as soon as they are scheduled.'}
          </p>
        </div>
      </div>
    )
  }

  const shelf = (title: string, list: Game[], size: 'lg' | 'md' = 'md', muted = false) =>
    list.length > 0 && (
      <Row title={title} count={list.length} muted={muted}>
        {list.map((g) => <GameTile key={g.gameId} game={g} size={size} onWatch={onGameClick} />)}
      </Row>
    )

  return (
    <div className={styles.container}>
      {error && <div className={styles.banner}>Couldn’t refresh the schedule. Retrying.</div>}
      <Hero games={featured} onWatch={onGameClick} />
      <div className={styles.rows}>
        {shelf('Live now', live, 'lg')}
        {shelf('Starting soon', soon, live.length === 0 ? 'lg' : 'md')}
        {scheduled.length < SPLIT_BY_DAY_MIN ? (
          shelf('Coming up', scheduled)
        ) : (
          <>
            {shelf('Later today', later.today)}
            {shelf('Tomorrow', later.tomorrow)}
            {shelf('This week', later.week)}
            {shelf('Coming up', later.beyond)}
          </>
        )}
        {shelf('Recently ended', ended, 'md', true)}
      </div>
    </div>
  )
}
