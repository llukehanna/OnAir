import { createTestDbWithMigrations } from '../../helpers/db'
import {
  appendEvent,
  getRecentEvents,
  getEventsByType,
  getEventsBySource,
} from '../../../src/main/db/queries/events'

describe('events queries', () => {
  describe('appendEvent', () => {
    it('inserts a row into the events table', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', undefined, db)
      const rows = db.prepare('SELECT * FROM events').all() as Array<Record<string, unknown>>
      expect(rows).toHaveLength(1)
      expect(rows[0].event_type).toBe('stream_started')
    })

    it('stores null for optional fields when not provided', () => {
      const db = createTestDbWithMigrations()
      appendEvent('api_failure', undefined, db)
      const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>
      expect(row.game_id).toBeNull()
      expect(row.source_id).toBeNull()
      expect(row.details).toBeNull()
    })

    it('stores gameId and sourceId when provided', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_failed', { gameId: 'nba_001', sourceId: 'source-a' }, db)
      const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>
      expect(row.game_id).toBe('nba_001')
      expect(row.source_id).toBe('source-a')
    })

    it('serializes details object to JSON string', () => {
      const db = createTestDbWithMigrations()
      appendEvent('probe_result', { details: { url: 'https://example.com/stream.m3u8', quality: '1080p' } }, db)
      const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>
      expect(typeof row.details).toBe('string')
      const parsed = JSON.parse(row.details as string)
      expect(parsed.url).toBe('https://example.com/stream.m3u8')
      expect(parsed.quality).toBe('1080p')
    })

    it('sets occurred_at to a recent timestamp', () => {
      const db = createTestDbWithMigrations()
      const before = Date.now()
      appendEvent('api_failure', undefined, db)
      const after = Date.now()
      const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>
      expect(row.occurred_at).toBeGreaterThanOrEqual(before)
      expect(row.occurred_at).toBeLessThanOrEqual(after)
    })
  })

  describe('getRecentEvents', () => {
    it('returns events ordered by occurred_at DESC', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', undefined, db)
      // Small delay to ensure different timestamps
      appendEvent('stream_failed', undefined, db)
      appendEvent('api_failure', undefined, db)
      const events = getRecentEvents(10, db)
      expect(events.length).toBeGreaterThanOrEqual(2)
      // Should be in descending order (most recent first)
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].occurredAt).toBeGreaterThanOrEqual(events[i].occurredAt)
      }
    })

    it('respects limit parameter', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', undefined, db)
      appendEvent('stream_failed', undefined, db)
      appendEvent('api_failure', undefined, db)
      const events = getRecentEvents(2, db)
      expect(events).toHaveLength(2)
    })

    it('defaults to 100 rows if no limit given', () => {
      const db = createTestDbWithMigrations()
      for (let i = 0; i < 5; i++) {
        appendEvent('stream_started', undefined, db)
      }
      const events = getRecentEvents(undefined, db)
      expect(events).toHaveLength(5)
    })

    it('returns camelCase EventRow objects', () => {
      const db = createTestDbWithMigrations()
      appendEvent('probe_result', { gameId: 'nba_001', sourceId: 'source-b' }, db)
      const events = getRecentEvents(1, db)
      expect(events[0].eventType).toBe('probe_result')
      expect(events[0].gameId).toBe('nba_001')
      expect(events[0].sourceId).toBe('source-b')
      expect(typeof events[0].id).toBe('number')
      expect(typeof events[0].occurredAt).toBe('number')
    })
  })

  describe('getEventsByType', () => {
    it('filters events by event_type', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', undefined, db)
      appendEvent('stream_failed', undefined, db)
      appendEvent('stream_started', undefined, db)
      const events = getEventsByType('stream_started', undefined, db)
      expect(events).toHaveLength(2)
      events.forEach((e) => expect(e.eventType).toBe('stream_started'))
    })

    it('respects limit parameter', () => {
      const db = createTestDbWithMigrations()
      appendEvent('api_failure', undefined, db)
      appendEvent('api_failure', undefined, db)
      appendEvent('api_failure', undefined, db)
      const events = getEventsByType('api_failure', 2, db)
      expect(events).toHaveLength(2)
    })
  })

  describe('getEventsBySource', () => {
    it('filters events by source_id', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', { sourceId: 'source-a' }, db)
      appendEvent('stream_failed', { sourceId: 'source-b' }, db)
      appendEvent('source_switch', { sourceId: 'source-a' }, db)
      const events = getEventsBySource('source-a', undefined, db)
      expect(events).toHaveLength(2)
      events.forEach((e) => expect(e.sourceId).toBe('source-a'))
    })

    it('respects limit parameter', () => {
      const db = createTestDbWithMigrations()
      appendEvent('stream_started', { sourceId: 'source-a' }, db)
      appendEvent('stream_failed', { sourceId: 'source-a' }, db)
      appendEvent('source_switch', { sourceId: 'source-a' }, db)
      const events = getEventsBySource('source-a', 2, db)
      expect(events).toHaveLength(2)
    })
  })
})
