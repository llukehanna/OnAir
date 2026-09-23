import { createTestDbWithMigrations } from '../../helpers/db'
import {
  getReliability,
  upsertReliability,
  recordStartupSuccess,
  recordStartupFailure,
  recordBufferEvent,
  recordSwitchEvent,
  resetConsecutiveFailures,
} from '../../../src/main/db/queries/reliability'
import { addSource } from '../../../src/main/db/queries/sources'
import type { Source } from '../../../src/main/types'

const testSource: Source = {
  sourceId: 'testsrc',
  name: 'Test Source',
  baseUrl: 'https://testsrc.com',
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

describe('reliability queries', () => {
  describe('upsertReliability', () => {
    it('creates a row with zeroed counters if not exists', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const metrics = upsertReliability('testsrc', 'nba', db)
      expect(metrics.sourceId).toBe('testsrc')
      expect(metrics.league).toBe('nba')
      expect(metrics.startupSuccesses).toBe(0)
      expect(metrics.startupFailures).toBe(0)
      expect(metrics.totalStartupTimeMs).toBe(0)
      expect(metrics.bufferEvents).toBe(0)
      expect(metrics.switchEvents).toBe(0)
      expect(metrics.totalSessions).toBe(0)
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('returns existing row when called again without changing counters', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupSuccess('testsrc', 'nba', 500, db)
      const metrics = upsertReliability('testsrc', 'nba', db)
      expect(metrics.startupSuccesses).toBe(1)
    })
  })

  describe('getReliability', () => {
    it('returns null when no row exists', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      const result = getReliability('testsrc', 'nba', db)
      expect(result).toBeNull()
    })

    it('returns ReliabilityMetrics after upsert', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)
      expect(metrics).not.toBeNull()
      expect(metrics!.sourceId).toBe('testsrc')
      expect(metrics!.league).toBe('nba')
    })
  })

  describe('recordStartupSuccess', () => {
    it('increments startup_successes and total_sessions', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupSuccess('testsrc', 'nba', 300, db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.startupSuccesses).toBe(1)
      expect(metrics.totalSessions).toBe(1)
    })

    it('adds latencyMs to total_startup_time_ms', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupSuccess('testsrc', 'nba', 300, db)
      recordStartupSuccess('testsrc', 'nba', 500, db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.totalStartupTimeMs).toBe(800)
    })

    it('resets consecutive_failures to 0', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      recordStartupSuccess('testsrc', 'nba', 200, db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.consecutiveFailures).toBe(0)
    })

    it('creates row if not exists (upsert behavior)', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      recordStartupSuccess('testsrc', 'nba', 400, db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.startupSuccesses).toBe(1)
    })
  })

  describe('recordStartupFailure', () => {
    it('increments startup_failures and consecutive_failures', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.startupFailures).toBe(2)
      expect(metrics.consecutiveFailures).toBe(2)
    })

    it('increments total_sessions', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.totalSessions).toBe(1)
    })
  })

  describe('recordBufferEvent', () => {
    it('increments buffer_events', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordBufferEvent('testsrc', 'nba', db)
      recordBufferEvent('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.bufferEvents).toBe(2)
    })
  })

  describe('recordSwitchEvent', () => {
    it('increments switch_events', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordSwitchEvent('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.switchEvents).toBe(1)
    })
  })

  describe('resetConsecutiveFailures', () => {
    it('resets consecutive_failures to 0', () => {
      const db = createTestDbWithMigrations()
      addSource(testSource, db)
      upsertReliability('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      recordStartupFailure('testsrc', 'nba', db)
      resetConsecutiveFailures('testsrc', 'nba', db)
      const metrics = getReliability('testsrc', 'nba', db)!
      expect(metrics.consecutiveFailures).toBe(0)
    })
  })
})
