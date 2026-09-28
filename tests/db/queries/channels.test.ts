import { createTestDbWithMigrations } from '../../helpers/db'
import {
  upsertChannelLinks,
  pruneChannelLinks,
  pruneChannelLinksForSource,
  getChannels,
  getChannelById,
  getChannelLinks,
} from '../../../src/main/db/queries/channels'
import { addSource } from '../../../src/main/db/queries/sources'
import type { Source } from '../../../src/main/types'

function makeSource(overrides: Partial<Source> & { sourceId: string }): Source {
  return {
    sourceId: overrides.sourceId,
    name: overrides.name ?? overrides.sourceId,
    baseUrl: overrides.baseUrl ?? `https://${overrides.sourceId}.test`,
    classification: overrides.classification ?? 'channel_first',
    supportedLeagues: overrides.supportedLeagues ?? ['nba'],
    extractionMethod: overrides.extractionMethod ?? 'network_intercept',
    confidenceWeight: overrides.confidenceWeight ?? 0.8,
    healthState: overrides.healthState ?? 'healthy',
    healthUpdatedAt: overrides.healthUpdatedAt ?? null,
    enabled: overrides.enabled ?? true,
    needsAdapter: overrides.needsAdapter ?? false,
    addedAt: overrides.addedAt ?? Date.now(),
  }
}

describe('channels queries', () => {
  describe('upsertChannelLinks / getChannels', () => {
    it('returns one channel with sourceCount 2 when two sources link it', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)
      addSource(makeSource({ sourceId: 'src_b' }), db)

      upsertChannelLinks('src_a', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://a.test/espn', label: 'ESPN' },
      ], Date.now(), db)
      upsertChannelLinks('src_b', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://b.test/espn', label: 'ESPN HD' },
      ], Date.now(), db)

      const channels = getChannels(db)
      expect(channels).toHaveLength(1)
      expect(channels[0].channelId).toBe('ch:espn')
      expect(channels[0].sourceCount).toBe(2)
    })

    it('is idempotent for the same source and channel', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)

      upsertChannelLinks('src_a', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://a.test/espn', label: 'ESPN' },
      ], 1000, db)
      upsertChannelLinks('src_a', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://a.test/espn2', label: 'ESPN v2' },
      ], 2000, db)

      const channels = getChannels(db)
      expect(channels).toHaveLength(1)
      expect(channels[0].sourceCount).toBe(1)

      const links = getChannelLinks('ch:espn', db)
      expect(links).toHaveLength(1)
      expect(links[0].url).toBe('https://a.test/espn2')
      expect(links[0].seenAt).toBe(2000)
    })

    it('sorts by name', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)

      upsertChannelLinks('src_a', [
        { channelId: 'ch:zzz', name: 'ZZZ Sports', category: 'sports', url: 'https://a.test/zzz', label: 'ZZZ' },
        { channelId: 'ch:aaa', name: 'AAA News', category: 'news', url: 'https://a.test/aaa', label: 'AAA' },
      ], Date.now(), db)

      const channels = getChannels(db)
      expect(channels.map((c) => c.channelId)).toEqual(['ch:aaa', 'ch:zzz'])
    })
  })

  describe('getChannelById', () => {
    it('returns null for an unknown channel', () => {
      const db = createTestDbWithMigrations()
      expect(getChannelById('ch:nope', db)).toBeNull()
    })

    it('returns the channel with its computed sourceCount', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)
      upsertChannelLinks('src_a', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://a.test/espn', label: 'ESPN' },
      ], Date.now(), db)

      const channel = getChannelById('ch:espn', db)
      expect(channel).not.toBeNull()
      expect(channel!.name).toBe('ESPN')
      expect(channel!.category).toBe('sports')
      expect(channel!.sourceCount).toBe(1)
    })
  })

  describe('getChannelLinks', () => {
    it('returns [] for a channel with no links', () => {
      const db = createTestDbWithMigrations()
      expect(getChannelLinks('ch:nope', db)).toEqual([])
    })
  })

  describe('pruneChannelLinks', () => {
    it('removes links older than the cutoff and orphaned channels', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_old' }), db)
      addSource(makeSource({ sourceId: 'src_fresh' }), db)

      const now = 1_000_000
      // src_old's link to ch:gone is stale; src_fresh's link to ch:stays is current.
      upsertChannelLinks('src_old', [
        { channelId: 'ch:gone', name: 'Gone', category: 'other', url: 'https://old.test/gone', label: 'Gone' },
      ], now - 100_000, db)
      upsertChannelLinks('src_fresh', [
        { channelId: 'ch:stays', name: 'Stays', category: 'other', url: 'https://fresh.test/stays', label: 'Stays' },
      ], now, db)

      pruneChannelLinks(50_000, now, db)

      const channels = getChannels(db)
      expect(channels.map((c) => c.channelId)).toEqual(['ch:stays'])
      expect(getChannelLinks('ch:gone', db)).toEqual([])
    })

    it('keeps a channel that still has at least one fresh link from another source', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_old' }), db)
      addSource(makeSource({ sourceId: 'src_fresh' }), db)

      const now = 1_000_000
      upsertChannelLinks('src_old', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://old.test/espn', label: 'ESPN' },
      ], now - 100_000, db)
      upsertChannelLinks('src_fresh', [
        { channelId: 'ch:espn', name: 'ESPN', category: 'sports', url: 'https://fresh.test/espn', label: 'ESPN' },
      ], now, db)

      pruneChannelLinks(50_000, now, db)

      const channel = getChannelById('ch:espn', db)
      expect(channel).not.toBeNull()
      expect(channel!.sourceCount).toBe(1)
      const links = getChannelLinks('ch:espn', db)
      expect(links).toHaveLength(1)
      expect(links[0].sourceId).toBe('src_fresh')
    })
  })

  describe('pruneChannelLinksForSource', () => {
    it('removes only the named source\'s stale links, leaving another source\'s stale link alone', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)
      addSource(makeSource({ sourceId: 'src_b' }), db)

      const now = 1_000_000
      upsertChannelLinks('src_a', [
        { channelId: 'ch:a-old', name: 'A Old', category: 'other', url: 'https://a.test/old', label: 'A Old' },
      ], now - 100_000, db)
      upsertChannelLinks('src_b', [
        { channelId: 'ch:b-old', name: 'B Old', category: 'other', url: 'https://b.test/old', label: 'B Old' },
      ], now - 100_000, db)

      pruneChannelLinksForSource('src_a', 50_000, now, db)

      expect(getChannelLinks('ch:a-old', db)).toEqual([])
      expect(getChannels(db).some((c) => c.channelId === 'ch:a-old')).toBe(false)
      // src_b's equally stale link is untouched — this call is scoped to src_a.
      expect(getChannelLinks('ch:b-old', db)).toHaveLength(1)
      expect(getChannels(db).some((c) => c.channelId === 'ch:b-old')).toBe(true)
    })

    it('removes a channel left with no links at all once its only source\'s link is pruned', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)

      const now = 1_000_000
      upsertChannelLinks('src_a', [
        { channelId: 'ch:gone', name: 'Gone', category: 'other', url: 'https://a.test/gone', label: 'Gone' },
      ], now - 100_000, db)

      pruneChannelLinksForSource('src_a', 50_000, now, db)

      expect(getChannels(db).some((c) => c.channelId === 'ch:gone')).toBe(false)
    })

    it('leaves a source\'s fresh links alone', () => {
      const db = createTestDbWithMigrations()
      addSource(makeSource({ sourceId: 'src_a' }), db)

      const now = 1_000_000
      upsertChannelLinks('src_a', [
        { channelId: 'ch:fresh', name: 'Fresh', category: 'other', url: 'https://a.test/fresh', label: 'Fresh' },
      ], now, db)

      pruneChannelLinksForSource('src_a', 50_000, now, db)

      expect(getChannelLinks('ch:fresh', db)).toHaveLength(1)
    })
  })
})
