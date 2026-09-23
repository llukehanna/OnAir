import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath ?? join(app.getPath('userData'), 'onair.db')
    db = new Database(resolvedPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
