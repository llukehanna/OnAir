import Database from 'better-sqlite3'
import { getDb } from '../connection'
import type { EventRow, EventType } from '../../types'

interface EventDbRow {
  id: number
  event_type: string
  game_id: string | null
  source_id: string | null
  details: string | null
  occurred_at: number
}

function rowToEvent(row: EventDbRow): EventRow {
  return {
    id: row.id,
    eventType: row.event_type as EventType,
    gameId: row.game_id,
    sourceId: row.source_id,
    details: row.details,
    occurredAt: row.occurred_at,
  }
}

export function appendEvent(
  eventType: EventType,
  opts?: { gameId?: string; sourceId?: string; details?: Record<string, unknown> },
  db?: Database.Database
): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT INTO events (event_type, game_id, source_id, details, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    eventType,
    opts?.gameId ?? null,
    opts?.sourceId ?? null,
    opts?.details ? JSON.stringify(opts.details) : null,
    Date.now()
  )
}

export function getRecentEvents(limit?: number, db?: Database.Database): EventRow[] {
  const d = db ?? getDb()
  const l = limit ?? 100
  const rows = d
    .prepare('SELECT * FROM events ORDER BY occurred_at DESC LIMIT ?')
    .all(l) as EventDbRow[]
  return rows.map(rowToEvent)
}

export function getEventsByType(eventType: EventType, limit?: number, db?: Database.Database): EventRow[] {
  const d = db ?? getDb()
  const l = limit ?? 50
  const rows = d
    .prepare('SELECT * FROM events WHERE event_type = ? ORDER BY occurred_at DESC LIMIT ?')
    .all(eventType, l) as EventDbRow[]
  return rows.map(rowToEvent)
}

export function getEventsBySource(sourceId: string, limit?: number, db?: Database.Database): EventRow[] {
  const d = db ?? getDb()
  const l = limit ?? 50
  const rows = d
    .prepare('SELECT * FROM events WHERE source_id = ? ORDER BY occurred_at DESC LIMIT ?')
    .all(sourceId, l) as EventDbRow[]
  return rows.map(rowToEvent)
}
