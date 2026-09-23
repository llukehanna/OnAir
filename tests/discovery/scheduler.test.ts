import { computeInterval, isLeagueOffSeason } from '../../src/main/discovery/scheduler'
import { createTestDbWithMigrations } from '../helpers/db'
import { upsertGame } from '../../src/main/db/queries/games'
import type { Game } from '../../src/main/types'

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    gameId: overrides.gameId ?? 'nba_001',
    league: overrides.league ?? 'nba',
    teamHome: overrides.teamHome ?? 'Lakers',
    teamAway: overrides.teamAway ?? 'Celtics',
    startTime: overrides.startTime ?? Date.now(),
    status: overrides.status ?? 'SCHEDULED',
  }
}

// ---------------------------------------------------------------------------
// DISC-01: computeInterval
// ---------------------------------------------------------------------------

describe('computeInterval', () => {
  it('returns 60_000 when games array contains a LIVE game', () => {
    const games: Game[] = [
      makeGame({ status: 'LIVE' }),
      makeGame({ gameId: 'nba_002', status: 'SCHEDULED', startTime: Date.now() + 2 * 60 * 60_000 }),
    ]
    expect(computeInterval(games)).toBe(60_000)
  })

  it('returns 120_000 when array contains STARTING_SOON but no LIVE games', () => {
    const games: Game[] = [
      makeGame({ status: 'STARTING_SOON', startTime: Date.now() + 20 * 60_000 }),
      makeGame({ gameId: 'nba_002', status: 'SCHEDULED', startTime: Date.now() + 3 * 60 * 60_000 }),
    ]
    expect(computeInterval(games)).toBe(120_000)
  })

  it('returns 120_000 when SCHEDULED game starts within 45 minutes (imminent window)', () => {
    const games: Game[] = [
      makeGame({ status: 'SCHEDULED', startTime: Date.now() + 45 * 60_000 }),
    ]
    expect(computeInterval(games)).toBe(120_000)
  })

  it('returns 600_000 when SCHEDULED games start 2+ hours away', () => {
    const games: Game[] = [
      makeGame({ status: 'SCHEDULED', startTime: Date.now() + 2 * 60 * 60_000 }),
      makeGame({ gameId: 'nba_002', status: 'SCHEDULED', startTime: Date.now() + 3 * 60 * 60_000 }),
    ]
    expect(computeInterval(games)).toBe(600_000)
  })

  it('returns 600_000 when games array is empty', () => {
    expect(computeInterval([])).toBe(600_000)
  })
})

// ---------------------------------------------------------------------------
// DISC-04: isLeagueOffSeason
// ---------------------------------------------------------------------------

describe('isLeagueOffSeason', () => {
  it('returns false when DB has an nba game with start_time = now (within 7 days)', () => {
    const db = createTestDbWithMigrations()
    upsertGame(makeGame({ gameId: 'nba_now', league: 'nba', startTime: Date.now() }), undefined, db)
    expect(isLeagueOffSeason('nba', db)).toBe(false)
  })

  it('returns true when DB has an nba game with start_time = 8 days ago (outside 7-day window)', () => {
    const db = createTestDbWithMigrations()
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60_000
    upsertGame(makeGame({ gameId: 'nba_old', league: 'nba', startTime: eightDaysAgo }), undefined, db)
    expect(isLeagueOffSeason('nba', db)).toBe(true)
  })

  it('returns true when DB has no nfl games at all', () => {
    const db = createTestDbWithMigrations()
    expect(isLeagueOffSeason('nfl', db)).toBe(true)
  })

  it('correctly differentiates nba (in-season) vs nfl (off-season) in same DB', () => {
    const db = createTestDbWithMigrations()
    // nba game within 7 days
    upsertGame(makeGame({ gameId: 'nba_recent', league: 'nba', startTime: Date.now() - 2 * 24 * 60 * 60_000 }), undefined, db)
    // nfl game outside 7 days
    const nflOld = Date.now() - 10 * 24 * 60 * 60_000
    upsertGame(makeGame({ gameId: 'nfl_old', league: 'nfl', startTime: nflOld, status: 'RECENTLY_ENDED' }), undefined, db)

    expect(isLeagueOffSeason('nba', db)).toBe(false)
    expect(isLeagueOffSeason('nfl', db)).toBe(true)
  })
})
