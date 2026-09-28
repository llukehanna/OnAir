import { discoverOnce, startChannelDiscovery, stopChannelDiscovery } from '../../src/main/channels/scheduler'
import { createTestDbWithMigrations } from '../helpers/db'
import { addSource } from '../../src/main/db/queries/sources'
import { getChannels, getChannelLinks } from '../../src/main/db/queries/channels'
import type { SourceAdapter } from '../../src/main/adapters/base'
import type { ChannelListing, Source } from '../../src/main/types'
import type { PlaywrightPool } from '../../src/main/adapters/pool'

function makeSource(sourceId: string): Source {
  return {
    sourceId,
    name: sourceId,
    baseUrl: `https://${sourceId}.test`,
    classification: 'channel_first',
    supportedLeagues: ['nba'],
    extractionMethod: 'network_intercept',
    confidenceWeight: 0.8,
    healthState: 'healthy',
    healthUpdatedAt: null,
    enabled: true,
    needsAdapter: false,
    addedAt: Date.now(),
  }
}

function makeAdapter(
  sourceId: string,
  listChannels: (pool: PlaywrightPool) => Promise<ChannelListing[]>
): SourceAdapter {
  return {
    sourceId,
    name: sourceId,
    baseUrl: `https://${sourceId}.test`,
    classification: 'channel_first',
    supportedLeagues: ['nba'],
    extractionMethod: 'network_intercept',
    confidenceWeight: 0.8,
    async getCandidateStreams() {
      return []
    },
    async getSourceHealth() {
      return 'healthy'
    },
    listChannels,
  }
}

// discoverOnce never actually acquires a page in these tests — the fake
// adapters' listChannels ignore it — so an empty object stands in for the pool.
const fakePool = {} as PlaywrightPool

describe('discoverOnce', () => {
  it('upserts canonicalized listings and prunes stale links, then returns getChannels()', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_a'), db)

    const adapters = [
      makeAdapter('src_a', async () => [
        { label: 'ESPN 2 HD', url: 'https://src_a.test/espn2' },
        { label: 'Lakers vs Celtics', url: 'https://src_a.test/game' }, // canonicalizes to null, skipped
      ]),
    ]

    const channels = await discoverOnce(fakePool, () => adapters, db)

    expect(channels.map((c) => c.channelId)).toEqual(['ch:espn2'])
    const links = getChannelLinks('ch:espn2', db)
    expect(links).toHaveLength(1)
    expect(links[0].sourceId).toBe('src_a')
    expect(links[0].url).toBe('https://src_a.test/espn2')
  })

  it('prunes a source\'s own links older than 24h once its pass lists something', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_a'), db)
    addSource(makeSource('src_stale'), db)

    // A link from 2 days ago that this round's src_stale pass no longer lists.
    const { upsertChannelLinks } = await import('../../src/main/db/queries/channels')
    upsertChannelLinks(
      'src_stale',
      [{ channelId: 'ch:old', name: 'Old', category: 'other', url: 'https://old.test/x', label: 'Old' }],
      Date.now() - 48 * 60 * 60_000,
      db
    )

    const adapters = [
      makeAdapter('src_a', async () => [{ label: 'CNN', url: 'https://src_a.test/cnn' }]),
      // src_stale's pass DID list something this round (≥1) — just not ch:old
      // — so its own stale link is fair game for pruning.
      makeAdapter('src_stale', async () => [{ label: 'BBC', url: 'https://src_stale.test/bbc' }]),
    ]

    const channels = await discoverOnce(fakePool, () => adapters, db)

    expect(channels.map((c) => c.channelId).sort()).toEqual(['ch:bbc', 'ch:cnn'])
    expect(getChannels(db).some((c) => c.channelId === 'ch:old')).toBe(false)
  })

  it('keeps a source\'s stale links past 24h when its pass returns [] (blocked/failed)', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_a'), db)
    addSource(makeSource('src_blocked'), db)

    const { upsertChannelLinks } = await import('../../src/main/db/queries/channels')
    upsertChannelLinks(
      'src_blocked',
      [{ channelId: 'ch:old', name: 'Old', category: 'other', url: 'https://old.test/x', label: 'Old' }],
      Date.now() - 48 * 60 * 60_000,
      db
    )

    const adapters = [
      makeAdapter('src_a', async () => [{ label: 'CNN', url: 'https://src_a.test/cnn' }]),
      // A blocked/failed pass returns [] — not evidence ch:old is gone.
      makeAdapter('src_blocked', async () => []),
    ]

    const channels = await discoverOnce(fakePool, () => adapters, db)

    expect(channels.map((c) => c.channelId).sort()).toEqual(['ch:cnn', 'ch:old'])
    expect(getChannels(db).some((c) => c.channelId === 'ch:old')).toBe(true)
  })

  it('does not let one adapter throwing stop the others', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_bad'), db)
    addSource(makeSource('src_good'), db)

    const adapters = [
      makeAdapter('src_bad', async () => {
        throw new Error('boom')
      }),
      makeAdapter('src_good', async () => [{ label: 'BBC', url: 'https://src_good.test/bbc' }]),
    ]

    const channels = await discoverOnce(fakePool, () => adapters, db)

    expect(channels.map((c) => c.channelId)).toEqual(['ch:bbc'])
  })

  it('skips adapters with no listChannels', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_no_channels'), db)
    const noChannelsAdapter: SourceAdapter = {
      sourceId: 'src_no_channels',
      name: 'src_no_channels',
      baseUrl: 'https://src_no_channels.test',
      classification: 'event_first',
      supportedLeagues: ['nba'],
      extractionMethod: 'network_intercept',
      confidenceWeight: 0.8,
      async getCandidateStreams() {
        return []
      },
      async getSourceHealth() {
        return 'healthy'
      },
    }

    const channels = await discoverOnce(fakePool, () => [noChannelsAdapter], db)
    expect(channels).toEqual([])
  })
})

describe('startChannelDiscovery / stopChannelDiscovery', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    stopChannelDiscovery()
    jest.useRealTimers()
  })

  it('runs discovery immediately and calls onUpdate with the result', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_a'), db)
    const adapters = [makeAdapter('src_a', async () => [{ label: 'CNN', url: 'https://src_a.test/cnn' }])]
    const onUpdate = jest.fn()

    startChannelDiscovery(fakePool, () => adapters, onUpdate, db)
    // Let the immediate run's promise chain settle.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0].map((c: { channelId: string }) => c.channelId)).toEqual(['ch:cnn'])
  })

  it('stopChannelDiscovery prevents the next scheduled run', async () => {
    const db = createTestDbWithMigrations()
    addSource(makeSource('src_a'), db)
    const adapters = [makeAdapter('src_a', async () => [{ label: 'CNN', url: 'https://src_a.test/cnn' }])]
    const onUpdate = jest.fn()

    startChannelDiscovery(fakePool, () => adapters, onUpdate, db)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(onUpdate).toHaveBeenCalledTimes(1)

    stopChannelDiscovery()
    jest.advanceTimersByTime(60 * 60_000)
    await Promise.resolve()

    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
