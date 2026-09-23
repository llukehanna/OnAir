import { createTestDbWithMigrations } from '../../helpers/db'
import { upsertGame, getGames, getGameById, deleteOldGames } from '../../../src/main/db/queries/games'
import type { Game } from '../../../src/main/types'

const nbaGame: Game = {
  gameId: 'nba_001',
  league: 'nba',
  teamHome: 'Los Angeles Lakers',
  teamAway: 'Boston Celtics',
  startTime: 1700000000000,
  status: 'LIVE',
}

const nflGame: Game = {
  gameId: 'nfl_001',
  league: 'nfl',
  teamHome: 'Dallas Cowboys',
  teamAway: 'New York Giants',
  startTime: 1700000001000,
  status: 'SCHEDULED',
}

describe('games queries', () => {
  describe('upsertGame', () => {
    it('inserts a new game row', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get('nba_001') as Record<string, unknown>
      expect(row).toBeTruthy()
      expect(row.league).toBe('nba')
      expect(row.team_home).toBe('Los Angeles Lakers')
      expect(row.team_away).toBe('Boston Celtics')
    })

    it('sets cached_at to a recent timestamp', () => {
      const db = createTestDbWithMigrations()
      const before = Date.now()
      upsertGame(nbaGame, undefined, db)
      const after = Date.now()
      const row = db.prepare('SELECT cached_at FROM games WHERE game_id = ?').get('nba_001') as { cached_at: number }
      expect(row.cached_at).toBeGreaterThanOrEqual(before)
      expect(row.cached_at).toBeLessThanOrEqual(after)
    })

    it('replaces an existing game on upsert', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      const updated = { ...nbaGame, status: 'RECENTLY_ENDED' as const }
      upsertGame(updated, undefined, db)
      const row = db.prepare('SELECT status FROM games WHERE game_id = ?').get('nba_001') as { status: string }
      expect(row.status).toBe('RECENTLY_ENDED')
    })

    it('stores rawData in the raw_data column', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, '{"espn":"data"}', db)
      const row = db.prepare('SELECT raw_data FROM games WHERE game_id = ?').get('nba_001') as { raw_data: string }
      expect(row.raw_data).toBe('{"espn":"data"}')
    })
  })

  describe('getGames', () => {
    it('returns all games when no league is specified', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      upsertGame(nflGame, undefined, db)
      const games = getGames(undefined, db)
      expect(games).toHaveLength(2)
    })

    it('filters by league', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      upsertGame(nflGame, undefined, db)
      const games = getGames('nba', db)
      expect(games).toHaveLength(1)
      expect(games[0].league).toBe('nba')
    })

    it('returns camelCase Game objects', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      const games = getGames(undefined, db)
      expect(games[0].gameId).toBe('nba_001')
      expect(games[0].teamHome).toBe('Los Angeles Lakers')
      expect(games[0].teamAway).toBe('Boston Celtics')
      expect(games[0].startTime).toBe(1700000000000)
      expect(games[0].status).toBe('LIVE')
    })

    it('returns empty array when no games exist', () => {
      const db = createTestDbWithMigrations()
      const games = getGames(undefined, db)
      expect(games).toHaveLength(0)
    })
  })

  describe('getGameById', () => {
    it('returns a Game for a known gameId', () => {
      const db = createTestDbWithMigrations()
      upsertGame(nbaGame, undefined, db)
      const game = getGameById('nba_001', db)
      expect(game).not.toBeNull()
      expect(game!.gameId).toBe('nba_001')
    })

    it('returns null for an unknown gameId', () => {
      const db = createTestDbWithMigrations()
      const game = getGameById('unknown_999', db)
      expect(game).toBeNull()
    })
  })

  describe('deleteOldGames', () => {
    it('deletes RECENTLY_ENDED games older than maxAgeMs', () => {
      const db = createTestDbWithMigrations()
      const oldGame: Game = {
        ...nbaGame,
        gameId: 'nba_old',
        status: 'RECENTLY_ENDED',
        startTime: Date.now() - 90000000, // 25 hours ago
      }
      upsertGame(oldGame, undefined, db)
      deleteOldGames(86400000, db) // 24 hours
      const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get('nba_old')
      expect(row).toBeUndefined()
    })

    it('does not delete RECENTLY_ENDED games within maxAgeMs', () => {
      const db = createTestDbWithMigrations()
      const recentGame: Game = {
        ...nbaGame,
        gameId: 'nba_recent',
        status: 'RECENTLY_ENDED',
        startTime: Date.now() - 3600000, // 1 hour ago
      }
      upsertGame(recentGame, undefined, db)
      deleteOldGames(86400000, db)
      const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get('nba_recent')
      expect(row).toBeTruthy()
    })

    it('does not delete LIVE or SCHEDULED games', () => {
      const db = createTestDbWithMigrations()
      const oldLive: Game = {
        ...nbaGame,
        gameId: 'nba_live_old',
        status: 'LIVE',
        startTime: Date.now() - 90000000,
      }
      upsertGame(oldLive, undefined, db)
      deleteOldGames(86400000, db)
      const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get('nba_live_old')
      expect(row).toBeTruthy()
    })
  })
})
