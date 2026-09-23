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
