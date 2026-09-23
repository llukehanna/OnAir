import { createTestDbWithMigrations } from '../../helpers/db'
import {
  getSources,
  getSourceById,
  getEnabledSourcesForLeague,
  updateSource,
  addSource,
  updateHealthState,
} from '../../../src/main/db/queries/sources'
import type { Source } from '../../../src/main/types'

const testSource: Source = {
  sourceId: 'testsource',
  name: 'Test Source',
  baseUrl: 'https://testsource.com',
  classification: 'event_first',
  supportedLeagues: ['nba', 'nfl'],
  extractionMethod: 'network_intercept',
  confidenceWeight: 0.9,
  healthState: 'unknown',
  healthUpdatedAt: null,
  enabled: true,
  needsAdapter: false,
  addedAt: 1700000000000,
}

describe('sources queries', () => {
  describe('getSources', () => {
    it('returns every stored source', () => {
      const db = createTestDbWithMigrations()
      expect(getSources(db)).toHaveLength(0)
      addSource(testSource, db)
      expect(getSources(db)).toHaveLength(1)
    })

    it('returns camelCase Source objects', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const sources = getSources(db)
      const found = sources.find((s) => s.sourceId === 'testsource')
      expect(found).toBeTruthy()
      expect(found!.baseUrl).toBe('https://testsource.com')
      expect(found!.supportedLeagues).toEqual(['nba', 'nfl'])
      expect(found!.confidenceWeight).toBe(0.9)
      expect(found!.healthState).toBe('unknown')
      expect(found!.enabled).toBe(true)
      expect(found!.needsAdapter).toBe(false)
    })
  })

  describe('getSourceById', () => {
    it('returns a Source for a known sourceId', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const source = getSourceById('testsource', db)
      expect(source).not.toBeNull()
      expect(source!.sourceId).toBe('testsource')
      expect(source!.name).toBe('Test Source')
    })

    it('returns null for unknown sourceId', () => {
      const db = createTestDbWithMigrations()
      const source = getSourceById('nonexistent', db)
      expect(source).toBeNull()
    })
  })

  describe('getEnabledSourcesForLeague', () => {
    it('returns enabled sources that support the given league', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const sources = getEnabledSourcesForLeague('nba', db)
      const found = sources.find((s) => s.sourceId === 'testsource')
      expect(found).toBeTruthy()
    })

    it('does not return disabled sources', () => {
      const db = createTestDbWithMigrations()
      const disabledSource: Source = {
        ...testSource,
        sourceId: 'disabled_source',
        enabled: false,
      }
      addSource(disabledSource, db)
      const sources = getEnabledSourcesForLeague('nba', db)
      const found = sources.find((s) => s.sourceId === 'disabled_source')
      expect(found).toBeUndefined()
    })

    it('does not return sources that do not support the league', () => {
      const db = createTestDbWithMigrations()
      const cbbOnly: Source = {
        ...testSource,
        sourceId: 'cbb_only',
        supportedLeagues: ['cbb'],
      }
      addSource(cbbOnly, db)
      const sources = getEnabledSourcesForLeague('nfl', db)
      const found = sources.find((s) => s.sourceId === 'cbb_only')
      expect(found).toBeUndefined()
    })
  })

  describe('addSource', () => {
    it('inserts a new source row', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const row = db.prepare('SELECT * FROM sources WHERE source_id = ?').get('testsource') as Record<string, unknown>
      expect(row).toBeTruthy()
      expect(row.name).toBe('Test Source')
    })
  })

  describe('updateSource', () => {
    it('updates specified fields on a source', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      updateSource('testsource', { name: 'Updated Name', confidenceWeight: 0.5 }, db)
      const source = getSourceById('testsource', db)
      expect(source!.name).toBe('Updated Name')
      expect(source!.confidenceWeight).toBe(0.5)
      // unchanged field
      expect(source!.baseUrl).toBe('https://testsource.com')
    })
  })

  describe('updateHealthState', () => {
    it('updates health_state and health_updated_at', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const before = Date.now()
      updateHealthState('testsource', 'healthy', db)
      const after = Date.now()
      const source = getSourceById('testsource', db)
      expect(source!.healthState).toBe('healthy')
      expect(source!.healthUpdatedAt).toBeGreaterThanOrEqual(before)
      expect(source!.healthUpdatedAt!).toBeLessThanOrEqual(after)
    })
  })
})
