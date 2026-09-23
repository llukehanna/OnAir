import React from 'react'
import { useGames } from '../../context/GamesContext'
import { GameCard, GameCardSkeleton } from '../../components/GameCard/GameCard'
import styles from './HomeScreen.module.css'

interface HomeScreenProps {
  selectedLeague: LeagueId | null
  onGameClick: (gameId: string) => void
}

export function HomeScreen({ selectedLeague, onGameClick }: HomeScreenProps): React.JSX.Element {
  const { games, loading, error } = useGames()

  // Filter by selected league
  const filtered = selectedLeague ? games.filter((g) => g.league === selectedLeague) : games

  // Group into three sections
  const liveGames = filtered
    .filter((g) => g.status === 'LIVE')
    .sort((a, b) => a.startTime - b.startTime)

  const soonGames = filtered
    .filter((g) => g.status === 'STARTING_SOON')
    .sort((a, b) => a.startTime - b.startTime)

  const upcomingGames = filtered
    .filter((g) => g.status === 'SCHEDULED')
    .sort((a, b) => a.startTime - b.startTime)

  const endedGames = filtered
    .filter((g) => g.status === 'RECENTLY_ENDED')
    .sort((a, b) => b.startTime - a.startTime) // most recent first

  const hasAnyGames =
    liveGames.length > 0 || soonGames.length > 0 || upcomingGames.length > 0 || endedGames.length > 0

  return (
    <div
      className={styles.container}
      aria-busy={loading ? 'true' : undefined}
    >
      {/* Loading state — show 6 skeletons */}
      {loading && (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error !== null && (
        <p className={styles.message}>Couldn&apos;t load games. Retrying...</p>
      )}

      {/* Empty state */}
      {!loading && error === null && !hasAnyGames && (
        <p className={styles.message}>No games scheduled right now.</p>
      )}

      {/* Live Now section */}
      {!loading && liveGames.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>
            <span className={styles.liveDot} aria-hidden="true" />
            Live Now
          </h2>
          <div className={styles.grid}>
            {liveGames.map((game) => (
              <GameCard key={game.gameId} game={game} onClick={onGameClick} />
            ))}
          </div>
        </section>
      )}

      {/* Starting Soon section */}
      {!loading && soonGames.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Starting Soon</h2>
          <div className={styles.grid}>
            {soonGames.map((game) => (
              <GameCard key={game.gameId} game={game} onClick={onGameClick} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming section */}
      {!loading && upcomingGames.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Upcoming</h2>
          <div className={styles.grid}>
            {upcomingGames.map((game) => (
              <GameCard key={game.gameId} game={game} onClick={onGameClick} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Ended section */}
      {!loading && endedGames.length > 0 && (
        <section className={styles.section}>
          <h2 className={`${styles.sectionHeading} ${styles.sectionHeadingSecondary}`}>
            Recently Ended
          </h2>
          <div className={styles.grid}>
            {endedGames.map((game) => (
              <GameCard key={game.gameId} game={game} onClick={onGameClick} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
