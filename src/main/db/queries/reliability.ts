import Database from 'better-sqlite3'
import { getDb } from '../connection'
import type { ReliabilityMetrics, LeagueId } from '../../types'

interface ReliabilityRow {
  id: number
  source_id: string
  league: string
  startup_successes: number
  startup_failures: number
  total_startup_time_ms: number
  buffer_events: number
  switch_events: number
  total_sessions: number
  consecutive_failures: number
  last_updated: number
}

function rowToMetrics(row: ReliabilityRow): ReliabilityMetrics {
  return {
    sourceId: row.source_id,
    league: row.league as LeagueId,
    startupSuccesses: row.startup_successes,
    startupFailures: row.startup_failures,
    totalStartupTimeMs: row.total_startup_time_ms,
    bufferEvents: row.buffer_events,
    switchEvents: row.switch_events,
    totalSessions: row.total_sessions,
    consecutiveFailures: row.consecutive_failures,
    lastUpdated: row.last_updated,
  }
}

export function getReliability(sourceId: string, league: LeagueId, db?: Database.Database): ReliabilityMetrics | null {
  const d = db ?? getDb()
  const row = d
    .prepare('SELECT * FROM source_reliability WHERE source_id = ? AND league = ?')
    .get(sourceId, league) as ReliabilityRow | undefined
  return row ? rowToMetrics(row) : null
}

export function upsertReliability(sourceId: string, league: LeagueId, db?: Database.Database): ReliabilityMetrics {
  const d = db ?? getDb()
  d.prepare(`
    INSERT OR IGNORE INTO source_reliability (
      source_id, league, startup_successes, startup_failures, total_startup_time_ms,
      buffer_events, switch_events, total_sessions, consecutive_failures, last_updated
    ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, ?)
  `).run(sourceId, league, Date.now())
  const row = d
    .prepare('SELECT * FROM source_reliability WHERE source_id = ? AND league = ?')
    .get(sourceId, league) as ReliabilityRow
  return rowToMetrics(row)
}

export function recordStartupSuccess(
  sourceId: string,
  league: LeagueId,
  latencyMs: number,
  db?: Database.Database
): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT INTO source_reliability (source_id, league, startup_successes, total_startup_time_ms, total_sessions, consecutive_failures, last_updated)
    VALUES (?, ?, 1, ?, 1, 0, ?)
    ON CONFLICT(source_id, league) DO UPDATE SET
      startup_successes = startup_successes + 1,
      total_startup_time_ms = total_startup_time_ms + ?,
      total_sessions = total_sessions + 1,
      consecutive_failures = 0,
      last_updated = ?
  `).run(sourceId, league, latencyMs, Date.now(), latencyMs, Date.now())
}

export function recordStartupFailure(sourceId: string, league: LeagueId, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT INTO source_reliability (source_id, league, startup_failures, total_sessions, consecutive_failures, last_updated)
    VALUES (?, ?, 1, 1, 1, ?)
    ON CONFLICT(source_id, league) DO UPDATE SET
      startup_failures = startup_failures + 1,
      total_sessions = total_sessions + 1,
      consecutive_failures = consecutive_failures + 1,
      last_updated = ?
  `).run(sourceId, league, Date.now(), Date.now())
}

export function recordBufferEvent(sourceId: string, league: LeagueId, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT INTO source_reliability (source_id, league, buffer_events, last_updated)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(source_id, league) DO UPDATE SET
      buffer_events = buffer_events + 1,
      last_updated = ?
  `).run(sourceId, league, Date.now(), Date.now())
}

export function recordSwitchEvent(sourceId: string, league: LeagueId, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT INTO source_reliability (source_id, league, switch_events, last_updated)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(source_id, league) DO UPDATE SET
      switch_events = switch_events + 1,
      last_updated = ?
  `).run(sourceId, league, Date.now(), Date.now())
}

export function resetConsecutiveFailures(sourceId: string, league: LeagueId, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    UPDATE source_reliability SET consecutive_failures = 0, last_updated = ?
    WHERE source_id = ? AND league = ?
  `).run(Date.now(), sourceId, league)
}
