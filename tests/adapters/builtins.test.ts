import type { Page, BrowserContext } from 'playwright'
import type Database from 'better-sqlite3'
import type { Game } from '../../src/main/types'
import type { PlaywrightPool } from '../../src/main/adapters/pool'
import { InterceptAdapter, type InterceptAdapterConfig } from '../../src/main/adapters/sources/intercept-base'
import { BUILTIN_ADAPTERS, ensureBuiltinSourceRows, registerBuiltinSources } from '../../src/main/adapters/sources'
import { clearAdapters, getAllAdapters } from '../../src/main/adapters/registry'
import { hostnameToSourceId, addSourcesBulk } from '../../src/main/sources/bulk-add'
import { addSource, getSources, getSourceById } from '../../src/main/db/queries/sources'
import { createTestDbWithMigrations } from '../helpers/db'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const game: Game = {
  gameId: 'test-game-1',
  league: 'nba',
  teamHome: 'Los Angeles Lakers',
  teamAway: 'Boston Celtics',
  startTime: Date.now(),
  status: 'LIVE',
}

const MASTER_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  'live_1080.m3u8',
  '',
].join('\n')

interface MockPageOptions {
  finalUrl?: string
  title?: string
  anchors?: { url: string; text: string }[]
  /** When set, the mock "player" requests this manifest shortly after the
   *  route handler is registered, as a real page's player would. */
  streamUrl?: string | null
}

function makeMockPage(opts: MockPageOptions): Page {
  const streamUrl = opts.streamUrl ?? null

  const context = {
    unrouteAll: jest.fn(async () => {}),
    clearCookies: jest.fn(async () => {}),
    route: jest.fn((_pattern: string, handler: (route: unknown) => Promise<void>) => {
      if (streamUrl === null) return
      // Simulate the page's player fetching the manifest.
      setTimeout(() => {
        void handler({
          request: () => ({ url: () => streamUrl, headers: () => ({}) }),
          continue: async () => {},
          abort: async () => {},
        })
      }, 10)
    }),
  } as unknown as BrowserContext

  return {
    goto: jest.fn(async () => null),
    title: jest.fn(async () => opts.title ?? 'Test Source'),
    url: jest.fn(() => opts.finalUrl ?? 'https://test.example/listing'),
    evaluate: jest.fn(async () => opts.anchors ?? []),
    unrouteAll: jest.fn(async () => {}),
    context: () => context,
    waitForTimeout: jest.fn(async () => {}),
    waitForResponse: jest.fn(async () => ({
      url: () => streamUrl ?? '',
      status: () => 200,
      body: async () => Buffer.from(MASTER_MANIFEST),
    })),
    close: jest.fn(async () => {}),
  } as unknown as Page
}

function makeFakePool(page: Page): { pool: PlaywrightPool; acquire: jest.Mock; release: jest.Mock } {
  const acquire = jest.fn(async () => page)
  const release = jest.fn()
  const pool = { acquire, release } as unknown as PlaywrightPool
  return { pool, acquire, release }
}

class TestAdapter extends InterceptAdapter {}

const testConfig: InterceptAdapterConfig = {
  sourceId: 'test-intercept',
  name: 'Test Intercept',
  baseUrl: 'https://test.example/',
  classification: 'mixed_aggregator',
  supportedLeagues: ['nba'],
  confidenceWeight: 0.5,
  gameLinkPatterns: [/\/watch\//],
  interceptTimeoutMs: 150,
  listingRenderTimeoutMs: 50,
}

// ---------------------------------------------------------------------------
// InterceptAdapter base
// ---------------------------------------------------------------------------

describe('InterceptAdapter', () => {
  it('follows the listing link that names the game and captures its stream', async () => {
    const page = makeMockPage({
      anchors: [
        // Wrong URL shape: never considered as a game link.
        { url: 'https://test.example/privacy', text: 'Lakers vs Celtics' },
        // Right URL shape, wrong game.
        { url: 'https://test.example/watch/warriors-knicks', text: 'Warriors vs Knicks Live' },
        // The game's own page.
        { url: 'https://test.example/watch/lakers-celtics', text: 'Lakers vs Celtics — Live Stream' },
      ],
      streamUrl: 'https://cdn.example/live/game.m3u8',
    })
    const { pool, acquire, release } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    const candidates = await adapter.getCandidateStreams(game, pool)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].streamUrl).toBe('https://cdn.example/live/game.m3u8')
    expect(candidates[0].streamType).toBe('hls')
    // The engine matcher scores the listing label, not the CDN URL.
    expect(candidates[0].matchText).toBe('Lakers vs Celtics — Live Stream')
    expect(candidates[0].refererUrl).toBe('https://test.example/watch/lakers-celtics')
    expect(candidates[0].quality).toBe('1080p')
    expect(candidates[0].preProbed?.qualityScore).toBe(0.9)
    expect(candidates[0].extractionConfidence).toBe(0.5)

    // Listing first, then the matched game page.
    const goto = page.goto as jest.Mock
    expect(goto).toHaveBeenNthCalledWith(1, 'https://test.example/', expect.anything())
    expect(goto).toHaveBeenNthCalledWith(2, 'https://test.example/watch/lakers-celtics', expect.anything())

    // User priority so clicks preempt background refreshes; always released.
    expect(acquire).toHaveBeenCalledWith('user')
    expect(release).toHaveBeenCalledWith(page)
  })

  it('waits for a client-rendered listing before giving up on the game link', async () => {
    // tvapp1.com / thetvapp.st render their game cards via JS after
    // 'domcontentloaded': the first scans see only nav links.
    const page = makeMockPage({ streamUrl: 'https://cdn.example/live/game.m3u8' })
    let scans = 0
    ;(page.evaluate as jest.Mock).mockImplementation(async () => {
      scans++
      if (scans <= 3) return [{ url: 'https://test.example/watch/nba-streams', text: 'NBA' }]
      return [{ url: 'https://test.example/watch/2610869', text: 'NBA Boston Celtics at Los Angeles Lakers ★ 3 sources HD' }]
    })
    const { pool } = makeFakePool(page)
    const adapter = new TestAdapter({ ...testConfig, listingRenderTimeoutMs: 5_000 })

    const candidates = await adapter.getCandidateStreams(game, pool)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].refererUrl).toBe('https://test.example/watch/2610869')
    expect(candidates[0].matchText).toBe('NBA Boston Celtics at Los Angeles Lakers ★ 3 sources HD')
    expect(page.waitForTimeout).toHaveBeenCalled()
  })

  it('returns [] when no listing link names the game', async () => {
    const page = makeMockPage({
      anchors: [{ url: 'https://test.example/watch/bulls-heat', text: 'Bulls vs Heat Live' }],
      streamUrl: null, // nothing is ever intercepted
    })
    const { pool, release } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getCandidateStreams(game, pool)).toEqual([])
    expect(release).toHaveBeenCalledWith(page)
  })

  it('returns [] when the listing page is bot-blocked', async () => {
    const page = makeMockPage({
      finalUrl: 'about:blank',
      anchors: [{ url: 'https://test.example/watch/lakers-celtics', text: 'Lakers vs Celtics' }],
      streamUrl: 'https://cdn.example/live/game.m3u8',
    })
    const { pool, release } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getCandidateStreams(game, pool)).toEqual([])
    expect(release).toHaveBeenCalledWith(page)
  })

  it('returns [] rather than throwing when the page misbehaves', async () => {
    const page: Page = {
      goto: jest.fn(async () => {
        throw new Error('net::ERR_CONNECTION_RESET')
      }),
      title: jest.fn(async () => 'Test Source'),
      url: jest.fn(() => 'https://test.example/listing'),
      evaluate: jest.fn(async () => []),
      context: () => ({}) as BrowserContext,
    } as unknown as Page
    const { pool, release } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getCandidateStreams(game, pool)).toEqual([])
    expect(release).toHaveBeenCalledWith(page)
  })

  it('reports healthy when the source page loads', async () => {
    const page = makeMockPage({ finalUrl: 'https://test.example/' })
    const { pool, acquire } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getSourceHealth(pool)).toBe('healthy')
    expect(acquire).toHaveBeenCalledWith('background')
  })

  it('reports broken when navigation never lands', async () => {
    const page = makeMockPage({ finalUrl: 'about:blank' })
    const { pool } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getSourceHealth(pool)).toBe('broken')
  })

  it('reports blocked on a bot-challenge page', async () => {
    const page = makeMockPage({ title: 'Just a moment...', finalUrl: 'https://test.example/listing' })
    const { pool } = makeFakePool(page)
    const adapter = new TestAdapter(testConfig)

    expect(await adapter.getSourceHealth(pool)).toBe('blocked')
  })
})

// ---------------------------------------------------------------------------
// InterceptAdapter.listChannels — bounded wait for client-rendered anchors
// (I1): the three real configured sources render their channel cards after
// 'domcontentloaded', so listChannels must give the page a chance to finish
// before scanning, never scan immediately, and never hang past the bound.
// ---------------------------------------------------------------------------

describe('InterceptAdapter.listChannels bounded wait', () => {
  const channelConfig: InterceptAdapterConfig = {
    ...testConfig,
    channels: { listUrl: 'https://test.example/channels', linkPatterns: [/^\/channel\//i] },
  }

  function makeSlowRenderPage(renderAfterCalls: number): { page: Page; waitForTimeout: jest.Mock } {
    let evaluateCalls = 0
    const waitForTimeout = jest.fn(async () => {})

    const evaluate = jest.fn(async () => {
      evaluateCalls++
      // Calls made while polling ask for the flat href list; only once
      // "rendered" does one contain a matching channel path. The final
      // call (collectChannelAnchors, after the poll loop breaks) wants the
      // richer {url, text} shape.
      if (evaluateCalls <= renderAfterCalls) return [] as string[]
      if (evaluateCalls === renderAfterCalls + 1) return ['https://test.example/channel/espn']
      return [{ url: 'https://test.example/channel/espn', text: 'ESPN' }]
    })

    const page = {
      goto: jest.fn(async () => null),
      url: jest.fn(() => 'https://test.example/channels'),
      title: jest.fn(async () => 'Test Source'),
      evaluate,
      waitForTimeout,
      waitForLoadState: jest.fn(async () => {}),
      close: jest.fn(async () => {}),
    } as unknown as Page

    return { page, waitForTimeout }
  }

  it('does not scan before anchors render — polls until a matching one appears', async () => {
    const { page, waitForTimeout } = makeSlowRenderPage(3)
    const { pool } = makeFakePool(page)
    const adapter = new TestAdapter(channelConfig)

    const result = await adapter.listChannels(pool)

    expect(result).toEqual([{ label: 'ESPN', url: 'https://test.example/channel/espn' }])
    // It had to poll more than once before the anchor appeared.
    expect(waitForTimeout.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('gives the network a further chance to settle via waitForLoadState(networkidle)', async () => {
    const { page } = makeSlowRenderPage(1)
    const { pool } = makeFakePool(page)
    const adapter = new TestAdapter(channelConfig)

    await adapter.listChannels(pool)

    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 5_000 })
  })

  it('returns [] rather than hanging when no anchor ever matches', async () => {
    // Fakes time passing 300ms per poll tick so the 5s poll bound elapses
    // without the test actually waiting 5 real seconds.
    let fakeNow = 0
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      fakeNow += 300
      return fakeNow
    })
    try {
      const evaluate = jest.fn(async () => [] as string[])
      const page = {
        goto: jest.fn(async () => null),
        url: jest.fn(() => 'https://test.example/channels'),
        title: jest.fn(async () => 'Test Source'),
        evaluate,
        waitForTimeout: jest.fn(async () => {}),
        waitForLoadState: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
      } as unknown as Page
      const { pool } = makeFakePool(page)
      const adapter = new TestAdapter(channelConfig)

      expect(await adapter.listChannels(pool)).toEqual([])
    } finally {
      dateSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Built-in source coverage
// ---------------------------------------------------------------------------

const EXPECTED_BASE_URLS = [
  'https://ntv.st/matches/kobra',
  'https://zlive.st/',
  'https://streamsports99.ru/live-tv',
  'https://famelack.com/',
  'https://tvapp1.com/',
  'https://thetvapp.plus/v9',
  'https://thetvapp.st/',
]

describe('built-in adapters', () => {
  it('cover exactly the requested sources', () => {
    expect([...BUILTIN_ADAPTERS.map((a) => a.baseUrl)].sort()).toEqual([...EXPECTED_BASE_URLS].sort())
  })

  it('derive each sourceId from its base URL hostname, as bulk-add does', () => {
    // A source pasted by hand gets the id hostnameToSourceId() produces; the
    // built-in row must share that id or the pipeline sees two sources.
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.sourceId).toBe(hostnameToSourceId(new URL(adapter.baseUrl).hostname))
    }
  })

  it('declare leagues, network interception, and a sane confidence', () => {
    for (const adapter of BUILTIN_ADAPTERS) {
      expect(adapter.supportedLeagues.length).toBeGreaterThan(0)
      expect(adapter.extractionMethod).toBe('network_intercept')
      expect(adapter.confidenceWeight).toBeGreaterThan(0)
      expect(adapter.confidenceWeight).toBeLessThanOrEqual(1)
    }
  })
})

describe('registerBuiltinSources / ensureBuiltinSourceRows', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDbWithMigrations()
    clearAdapters()
  })

  afterEach(() => {
    db.close()
    clearAdapters()
  })

  it('seeds an adapter-backed row per source and registers every adapter', () => {
    registerBuiltinSources(db)

    expect(getAllAdapters()).toHaveLength(BUILTIN_ADAPTERS.length)
    for (const adapter of BUILTIN_ADAPTERS) {
      const row = getSourceById(adapter.sourceId, db)
      expect(row).not.toBeNull()
      expect(row?.needsAdapter).toBe(false)
      expect(row?.enabled).toBe(true)
      expect(row?.baseUrl).toBe(adapter.baseUrl)
      expect(row?.supportedLeagues).toEqual(adapter.supportedLeagues)
      expect(row?.extractionMethod).toBe(adapter.extractionMethod)
      expect(row?.confidenceWeight).toBe(adapter.confidenceWeight)
    }
  })

  it('are idempotent — seeding twice does not duplicate rows', () => {
    ensureBuiltinSourceRows(db)
    ensureBuiltinSourceRows(db)
    expect(getSources(db)).toHaveLength(BUILTIN_ADAPTERS.length)
  })

  it('adopt a host previously pasted via bulk-add', () => {
    addSourcesBulk('https://ntv.st/matches/kobra', db)
    const pasted = getSourceById('ntv-st', db)!
    expect(pasted.needsAdapter).toBe(true)
    expect(pasted.supportedLeagues).toEqual([])

    ensureBuiltinSourceRows(db)

    const adopted = getSourceById('ntv-st', db)!
    expect(adopted.needsAdapter).toBe(false)
    expect(adopted.supportedLeagues).toEqual(['nba', 'nfl', 'mlb', 'cbb', 'cfb'])
    expect(adopted.classification).toBe('mixed_aggregator')
  })

  it('never clobber a row the operator has edited', () => {
    addSource(
      {
        sourceId: 'zlive-st',
        name: 'My ZLive',
        baseUrl: 'https://zlive.st/custom-path',
        classification: 'mixed_aggregator',
        supportedLeagues: ['nba'],
        extractionMethod: 'network_intercept',
        confidenceWeight: 0.9,
        healthState: 'healthy',
        healthUpdatedAt: Date.now(),
        enabled: false,
        needsAdapter: false,
        addedAt: 1,
      },
      db
    )

    ensureBuiltinSourceRows(db)

    const row = getSourceById('zlive-st', db)!
    expect(row.name).toBe('My ZLive')
    expect(row.baseUrl).toBe('https://zlive.st/custom-path')
    expect(row.enabled).toBe(false)
    expect(row.confidenceWeight).toBe(0.9)
  })
})


