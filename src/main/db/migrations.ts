import Database from 'better-sqlite3'
import { getDb } from './connection'

interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE games (
          game_id       TEXT PRIMARY KEY,
          league        TEXT NOT NULL,
          team_home     TEXT NOT NULL,
          team_away     TEXT NOT NULL,
          start_time    INTEGER NOT NULL,
          status        TEXT NOT NULL,
          raw_data      TEXT,
          cached_at     INTEGER NOT NULL
        );

        CREATE INDEX idx_games_status ON games(status);
        CREATE INDEX idx_games_league ON games(league);
        CREATE INDEX idx_games_start_time ON games(start_time);

        CREATE TABLE sources (
          source_id           TEXT PRIMARY KEY,
          name                TEXT NOT NULL,
          base_url            TEXT NOT NULL,
          classification      TEXT NOT NULL,
          supported_leagues   TEXT NOT NULL,
          extraction_method   TEXT NOT NULL,
          confidence_weight   REAL NOT NULL DEFAULT 1.0,
          health_state        TEXT NOT NULL DEFAULT 'unknown',
          health_updated_at   INTEGER,
          enabled             INTEGER NOT NULL DEFAULT 1,
          needs_adapter       INTEGER NOT NULL DEFAULT 0,
          added_at            INTEGER NOT NULL
        );

        CREATE TABLE source_reliability (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id             TEXT NOT NULL,
          league                TEXT NOT NULL,
          startup_successes     INTEGER NOT NULL DEFAULT 0,
          startup_failures      INTEGER NOT NULL DEFAULT 0,
          total_startup_time_ms INTEGER NOT NULL DEFAULT 0,
          buffer_events         INTEGER NOT NULL DEFAULT 0,
          switch_events         INTEGER NOT NULL DEFAULT 0,
          total_sessions        INTEGER NOT NULL DEFAULT 0,
          consecutive_failures  INTEGER NOT NULL DEFAULT 0,
          last_updated          INTEGER NOT NULL,

          UNIQUE(source_id, league),
          FOREIGN KEY(source_id) REFERENCES sources(source_id)
        );

        CREATE INDEX idx_reliability_source ON source_reliability(source_id);

        CREATE TABLE stream_candidates (
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

        CREATE INDEX idx_candidates_game ON stream_candidates(game_id, score DESC);
        CREATE INDEX idx_candidates_probed_at ON stream_candidates(probed_at);

        CREATE TABLE events (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type    TEXT NOT NULL,
          game_id       TEXT,
          source_id     TEXT,
          details       TEXT,
          occurred_at   INTEGER NOT NULL
        );

        CREATE INDEX idx_events_type ON events(event_type);
        CREATE INDEX idx_events_occurred_at ON events(occurred_at);
        CREATE INDEX idx_events_source ON events(source_id);
      `)
    }
  },
  {
    version: 2,
    name: 'games_detail_json',
    // Team/game detail from ESPN (logos, colors, scores, clock), stored as JSON.
    up: (db) => {
      db.exec('ALTER TABLE games ADD COLUMN detail_json TEXT')
    }
  },
  {
    version: 3,
    name: 'channels_and_candidate_targets',
    // Adds channel storage and lets stream_candidates carry a channel id.
    up: (db) => {
      db.exec(`
        CREATE TABLE channels (
          channel_id    TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          category      TEXT NOT NULL,
          last_seen_at  INTEGER NOT NULL
        );

        CREATE TABLE channel_sources (
          channel_id  TEXT NOT NULL,
          source_id   TEXT NOT NULL,
          url         TEXT NOT NULL,
          label       TEXT NOT NULL,
          seen_at     INTEGER NOT NULL,

          PRIMARY KEY(channel_id, source_id),
          FOREIGN KEY(channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE,
          FOREIGN KEY(source_id) REFERENCES sources(source_id)
        );
      `)

      // stream_candidates.game_id previously had FOREIGN KEY -> games(game_id),
      // but a channel id ('ch:espn') is never a row in games. SQLite can't drop
      // a constraint in place, so rebuild: create the new shape, copy every
      // row across, drop the old table, rename the new one into place.
      db.exec(`
        CREATE TABLE stream_candidates_new (
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

          FOREIGN KEY(source_id) REFERENCES sources(source_id)
        );

        INSERT INTO stream_candidates_new (
          id, game_id, source_id, stream_url, stream_type, quality, score,
          probe_success, probe_latency_ms, probed_at
        )
        SELECT
          id, game_id, source_id, stream_url, stream_type, quality, score,
          probe_success, probe_latency_ms, probed_at
        FROM stream_candidates;

        DROP TABLE stream_candidates;
        ALTER TABLE stream_candidates_new RENAME TO stream_candidates;

        CREATE INDEX idx_candidates_game ON stream_candidates(game_id, score DESC);
        CREATE INDEX idx_candidates_probed_at ON stream_candidates(probed_at);
      `)
    }
  },
  {
    version: 4,
    name: 'sources_add_nhl',
    // Built-in rows are seeded once and never re-synced, so rows still holding
    // the pre-NHL default league list pick up 'nhl'. A row with any other
    // list was edited by the operator and is left alone.
    up: (db) => {
      db.prepare('UPDATE sources SET supported_leagues = ? WHERE supported_leagues = ?').run(
        JSON.stringify(['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb']),
        JSON.stringify(['nba', 'nfl', 'mlb', 'cbb', 'cfb'])
      )
    }
  },
  {
    version: 5,
    name: 'thetvapp_confidence',
    // TheTVApp mirrors went from 0.6 to 0.85 (adapters/sources/thetvapp.ts).
    // Same re-sync rule as v4: only rows still on the old seed value move.
    up: (db) => {
      db.prepare(
        "UPDATE sources SET confidence_weight = 0.85 WHERE source_id IN ('tvapp1-com', 'thetvapp-plus', 'thetvapp-st') AND confidence_weight = 0.6"
      ).run()
    }
  },
]

export function runMigrations(dbOverride?: Database.Database): void {
  const db = dbOverride ?? getDb()

  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL
    )
  `)

  // Get applied versions
  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as { version: number }[])
      .map((row) => row.version)
  )

  // Run pending migrations
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      const applyMigration = db.transaction(() => {
        migration.up(db)
        db.prepare(
          'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, Date.now())
      })
      applyMigration()
    }
  }
}
