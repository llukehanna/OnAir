import Database from 'better-sqlite3'
import { runMigrations } from '../../src/main/db/migrations'

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function createTestDbWithMigrations(): Database.Database {
  const db = createTestDb()
  runMigrations(db)
  return db
}
