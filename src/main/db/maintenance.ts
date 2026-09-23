import Database from 'better-sqlite3'
import { getDb } from './connection'
import { deleteOldGames } from './queries/games'

// ---------------------------------------------------------------------------
// Startup maintenance
//
// Nothing pruned anything before this. deleteOldGames() existed but was never
// called from anywhere, and the events table had no retention at all, so both
// grew for the life of the install.
//
// Runs once at startup rather than on a timer: this is a desktop app that gets
// restarted, and a background sweep competing with a user click for the SQLite
// write lock is a worse trade than a few milliseconds at launch.
// ---------------------------------------------------------------------------

/** Games that finished more than this long ago are dropped. */
const GAME_RETENTION_MS = 7 * 24 * 60 * 60_000

/** Events older than this are dropped. Kept long enough to diagnose a bad week. */
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000

/** Above this row count, the events table is trimmed to the newest rows. */
const EVENT_ROW_CEILING = 50_000

export interface MaintenanceResult {
  gamesDeleted: number
  eventsDeleted: number
}

export function runMaintenance(db?: Database.Database): MaintenanceResult {
  const d = db ?? getDb()

  const gamesBefore = d.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }
  deleteOldGames(GAME_RETENTION_MS, d)
  const gamesAfter = d.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }

  const byAge = d
    .prepare('DELETE FROM events WHERE occurred_at < ?')
    .run(Date.now() - EVENT_RETENTION_MS)

  // A burst of failures can blow past the age window on its own, so cap rows
  // as well as age.
  const byCount = d
    .prepare(
      `DELETE FROM events WHERE id NOT IN (
         SELECT id FROM events ORDER BY occurred_at DESC LIMIT ?
       )`
    )
    .run(EVENT_ROW_CEILING)

  return {
    gamesDeleted: gamesBefore.n - gamesAfter.n,
    eventsDeleted: byAge.changes + byCount.changes,
  }
}

/**
 * Reclaims free pages. Separate from runMaintenance because VACUUM rewrites the
 * whole file and cannot run inside a transaction — it is worth doing only when
 * a delete actually freed something.
 */
export function vacuumIfNeeded(db?: Database.Database, minFreeBytes = 16 * 1024 * 1024): boolean {
  const d = db ?? getDb()
  const { freelist_count: free } = d.prepare('PRAGMA freelist_count').get() as {
    freelist_count: number
  }
  const { page_size: pageSize } = d.prepare('PRAGMA page_size').get() as { page_size: number }

  if (free * pageSize < minFreeBytes) return false
  d.exec('VACUUM')
  return true
}
