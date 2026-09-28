import { createTestDb, createTestDbWithMigrations } from '../helpers/db'
import { runMigrations } from '../../src/main/db/migrations'

describe('runMigrations', () => {
  it('creates all expected tables', () => {
    const db = createTestDbWithMigrations()

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((row) => row.name)

    expect(tables).toContain('games')
    expect(tables).toContain('sources')
    expect(tables).toContain('source_reliability')
    expect(tables).toContain('stream_candidates')
    expect(tables).toContain('events')

    db.close()
  })

  it('is idempotent — running twice produces no errors', () => {
    const db = createTestDb()

    expect(() => {
      runMigrations(db)
      runMigrations(db)
    }).not.toThrow()

    db.close()
  })

  it('schema_version tracks applied migrations', () => {
    const db = createTestDbWithMigrations()

    const versions = (
      db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[]
    ).map((row) => row.version)

    expect(versions).toEqual([1, 2])

    db.close()
  })

  it('v2 adds a nullable detail_json column to games', () => {
    const db = createTestDbWithMigrations()
    const columns = db.prepare('PRAGMA table_info(games)').all() as { name: string; type: string; notnull: number }[]
    const detail = columns.find((c) => c.name === 'detail_json')
    expect(detail).toBeDefined()
    expect(detail!.type).toBe('TEXT')
    expect(detail!.notnull).toBe(0)
    db.close()
  })

  it('upgrades a v1 database to v2 without losing rows', () => {
    const db = createTestDb()
    runMigrations(db)
    // Simulate a database that only ever saw v1: drop the v2 column and its version row.
    db.exec('ALTER TABLE games DROP COLUMN detail_json')
    db.prepare('DELETE FROM schema_version WHERE version = 2').run()
    db.prepare(`
      INSERT INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
      VALUES ('nba_1', 'nba', 'Home', 'Away', 1, 'LIVE', 1)
    `).run()

    runMigrations(db)

    const row = db.prepare('SELECT game_id, detail_json FROM games').get() as { game_id: string; detail_json: string | null }
    expect(row).toEqual({ game_id: 'nba_1', detail_json: null })
    db.close()
  })

  it('ships with no sources — adapters register their own', () => {
    const db = createTestDbWithMigrations()
    const count = (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n
    expect(count).toBe(0)
    db.close()
  })

  it('all expected indexes exist', () => {
    const db = createTestDbWithMigrations()

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as { name: string }[]
    ).map((row) => row.name)

    expect(indexes).toContain('idx_games_status')
    expect(indexes).toContain('idx_games_league')
    expect(indexes).toContain('idx_games_start_time')
    expect(indexes).toContain('idx_reliability_source')
    expect(indexes).toContain('idx_candidates_game')
    expect(indexes).toContain('idx_candidates_probed_at')
    expect(indexes).toContain('idx_events_type')
    expect(indexes).toContain('idx_events_occurred_at')
    expect(indexes).toContain('idx_events_source')

    db.close()
  })

  it('foreign keys are enforced', () => {
    const db = createTestDbWithMigrations()

    // Trying to insert a source_reliability row with a non-existent source_id should throw
    expect(() => {
      db.prepare(`
        INSERT INTO source_reliability (source_id, league, last_updated)
        VALUES ('nonexistent_source', 'nba', ?)
      `).run(Date.now())
    }).toThrow()

    db.close()
  })
})
