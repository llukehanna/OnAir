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
    expect(tables).toContain('channels')
    expect(tables).toContain('channel_sources')

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

    expect(versions).toEqual([1, 2, 3, 4])

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

  describe('v3 channels_and_candidate_targets', () => {
    it('accepts a stream_candidates row whose game_id is a channel id, with foreign keys on', () => {
      const db = createTestDbWithMigrations()

      // The source FK on stream_candidates remains — only the games FK is gone.
      db.prepare(`
        INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
          extraction_method, confidence_weight, health_state, enabled, needs_adapter, added_at)
        VALUES ('src_ch', 'Src', 'https://src.test', 'event_first', '["nba"]',
          'network_intercept', 0.8, 'healthy', 1, 0, ?)
      `).run(Date.now())

      expect(() => {
        db.prepare(`
          INSERT INTO stream_candidates (game_id, source_id, stream_url, stream_type, score, probe_success, probed_at)
          VALUES ('ch:x', 'src_ch', 'https://cdn.test/stream.m3u8', 'hls', 0.9, 1, ?)
        `).run(Date.now())
      }).not.toThrow()

      const row = db.prepare("SELECT game_id FROM stream_candidates WHERE game_id = 'ch:x'").get()
      expect(row).toBeDefined()

      db.close()
    })

    it('still rejects a stream_candidates row whose source_id does not exist', () => {
      const db = createTestDbWithMigrations()

      expect(() => {
        db.prepare(`
          INSERT INTO stream_candidates (game_id, source_id, stream_url, stream_type, score, probe_success, probed_at)
          VALUES ('ch:x', 'nonexistent_source', 'https://cdn.test/stream.m3u8', 'hls', 0.9, 1, ?)
        `).run(Date.now())
      }).toThrow()

      db.close()
    })

    it('upgrading a v2 database preserves existing stream_candidates rows', () => {
      const db = createTestDb()
      runMigrations(db)

      // Revert to the pre-v3 shape: stream_candidates with a games FK, no
      // channel tables — then seed a row the way a v1+v2 install would have.
      db.exec('DROP TABLE channels')
      db.exec('DROP TABLE channel_sources')
      db.exec(`
        CREATE TABLE stream_candidates_old (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id               TEXT NOT NULL,
          source_id             TEXT NOT NULL,
          stream_url            TEXT NOT NULL,
          stream_type           TEXT NOT NULL,
          quality               TEXT,
          score                 REAL NOT NULL,
          probe_success         INTEGER NOT NULL,
          probe_latency_ms      INTEGER,
          probed_at             INTEGER NOT NULL,
          FOREIGN KEY(game_id) REFERENCES games(game_id),
          FOREIGN KEY(source_id) REFERENCES sources(source_id)
        );
        DROP TABLE stream_candidates;
        ALTER TABLE stream_candidates_old RENAME TO stream_candidates;
        CREATE INDEX idx_candidates_game ON stream_candidates(game_id, score DESC);
        CREATE INDEX idx_candidates_probed_at ON stream_candidates(probed_at);
      `)
      db.prepare('DELETE FROM schema_version WHERE version = 3').run()

      db.prepare(`
        INSERT INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
        VALUES ('nba_1', 'nba', 'Home', 'Away', 1, 'LIVE', 1)
      `).run()
      db.prepare(`
        INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
          extraction_method, confidence_weight, health_state, enabled, needs_adapter, added_at)
        VALUES ('src_old', 'Src', 'https://src.test', 'event_first', '["nba"]',
          'network_intercept', 0.8, 'healthy', 1, 0, ?)
      `).run(Date.now())
      db.prepare(`
        INSERT INTO stream_candidates (game_id, source_id, stream_url, stream_type, score, probe_success, probed_at)
        VALUES ('nba_1', 'src_old', 'https://cdn.test/old.m3u8', 'hls', 0.7, 1, ?)
      `).run(Date.now())

      runMigrations(db)

      const row = db.prepare(
        "SELECT game_id, source_id, stream_url FROM stream_candidates WHERE game_id = 'nba_1'"
      ).get() as { game_id: string; source_id: string; stream_url: string }
      expect(row).toEqual({ game_id: 'nba_1', source_id: 'src_old', stream_url: 'https://cdn.test/old.m3u8' })

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
      ).map((r) => r.name)
      expect(tables).toContain('channels')
      expect(tables).toContain('channel_sources')

      db.close()
    })

    it('recreates the stream_candidates indexes', () => {
      const db = createTestDbWithMigrations()

      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as { name: string }[]
      ).map((row) => row.name)

      expect(indexes).toContain('idx_candidates_game')
      expect(indexes).toContain('idx_candidates_probed_at')

      db.close()
    })
  })

  describe('v4 sources_add_nhl', () => {
    it('adds nhl to rows still on the old default list and leaves edited rows alone', () => {
      const db = createTestDbWithMigrations()
      const insert = db.prepare(`
        INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
          extraction_method, confidence_weight, health_state, enabled, needs_adapter, added_at)
        VALUES (?, ?, 'https://example.invalid', 'mixed_aggregator', ?, 'network_intercept', 0.5, 'unknown', 1, 0, 0)
      `)
      insert.run('seeded', 'Seeded', JSON.stringify(['nba', 'nfl', 'mlb', 'cbb', 'cfb']))
      insert.run('edited', 'Edited', JSON.stringify(['nba']))

      // Re-run v4 as if upgrading a v3 database that already had these rows.
      db.prepare('DELETE FROM schema_version WHERE version = 4').run()
      runMigrations(db)

      const leagues = (id: string): string[] =>
        JSON.parse((db.prepare('SELECT supported_leagues FROM sources WHERE source_id = ?').get(id) as { supported_leagues: string }).supported_leagues)
      expect(leagues('seeded')).toEqual(['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb'])
      expect(leagues('edited')).toEqual(['nba'])

      db.close()
    })
  })
})
