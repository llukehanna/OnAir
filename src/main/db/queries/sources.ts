import Database from 'better-sqlite3'
import { getDb } from '../connection'
import type { Source, LeagueId, HealthState, SourceClassification, ExtractionMethod } from '../../types'

interface SourceRow {
  source_id: string
  name: string
  base_url: string
  classification: string
  supported_leagues: string
  extraction_method: string
  confidence_weight: number
  health_state: string
  health_updated_at: number | null
  enabled: number
  needs_adapter: number
  added_at: number
}

function rowToSource(row: SourceRow): Source {
  return {
    sourceId: row.source_id,
    name: row.name,
    baseUrl: row.base_url,
    classification: row.classification as SourceClassification,
    supportedLeagues: JSON.parse(row.supported_leagues) as LeagueId[],
    extractionMethod: row.extraction_method as ExtractionMethod,
    confidenceWeight: row.confidence_weight,
    healthState: row.health_state as HealthState,
    healthUpdatedAt: row.health_updated_at,
    enabled: row.enabled === 1,
    needsAdapter: row.needs_adapter === 1,
    addedAt: row.added_at,
  }
}

// Map from camelCase Source field names to DB snake_case column names
const FIELD_TO_COLUMN: Record<string, string> = {
  sourceId: 'source_id',
  name: 'name',
  baseUrl: 'base_url',
  classification: 'classification',
  supportedLeagues: 'supported_leagues',
  extractionMethod: 'extraction_method',
  confidenceWeight: 'confidence_weight',
  healthState: 'health_state',
  healthUpdatedAt: 'health_updated_at',
  enabled: 'enabled',
  needsAdapter: 'needs_adapter',
  addedAt: 'added_at',
}

function toDbValue(key: string, value: unknown): unknown {
  if (key === 'supportedLeagues') return JSON.stringify(value)
  if (key === 'enabled') return value ? 1 : 0
  if (key === 'needsAdapter') return value ? 1 : 0
  return value
}

export function getSources(db?: Database.Database): Source[] {
  const d = db ?? getDb()
  const rows = d.prepare('SELECT * FROM sources').all() as SourceRow[]
  return rows.map(rowToSource)
}

export function getSourceById(sourceId: string, db?: Database.Database): Source | null {
  const d = db ?? getDb()
  const row = d.prepare('SELECT * FROM sources WHERE source_id = ?').get(sourceId) as SourceRow | undefined
  return row ? rowToSource(row) : null
}

export function getEnabledSourcesForLeague(league: LeagueId, db?: Database.Database): Source[] {
  const d = db ?? getDb()
  const rows = d.prepare('SELECT * FROM sources WHERE enabled = 1').all() as SourceRow[]
  return rows
    .filter((row) => {
      const leagues = JSON.parse(row.supported_leagues) as string[]
      return leagues.includes(league)
    })
    .map(rowToSource)
}

export function updateSource(sourceId: string, patch: Partial<Source>, db?: Database.Database): void {
  const d = db ?? getDb()
  const entries = Object.entries(patch).filter(([key]) => key !== 'sourceId' && FIELD_TO_COLUMN[key])
  if (entries.length === 0) return

  const setClauses = entries.map(([key]) => `${FIELD_TO_COLUMN[key]} = ?`).join(', ')
  const values = entries.map(([key, value]) => toDbValue(key, value))
  values.push(sourceId)

  d.prepare(`UPDATE sources SET ${setClauses} WHERE source_id = ?`).run(...values)
}

export function addSource(source: Source, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT OR REPLACE INTO sources (
      source_id, name, base_url, classification, supported_leagues,
      extraction_method, confidence_weight, health_state, health_updated_at,
      enabled, needs_adapter, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source.sourceId,
    source.name,
    source.baseUrl,
    source.classification,
    JSON.stringify(source.supportedLeagues),
    source.extractionMethod,
    source.confidenceWeight,
    source.healthState,
    source.healthUpdatedAt,
    source.enabled ? 1 : 0,
    source.needsAdapter ? 1 : 0,
    source.addedAt
  )
}

export function updateHealthState(sourceId: string, newState: HealthState, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare('UPDATE sources SET health_state = ?, health_updated_at = ? WHERE source_id = ?')
    .run(newState, Date.now(), sourceId)
}
