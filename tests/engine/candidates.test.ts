import { collectAndRankCandidates } from '../../src/main/engine/candidates'
import type { SourceAdapter, RawStreamCandidate } from '../../src/main/adapters/base'
import type { Game, WatchTarget, ChannelSourceLink } from '../../src/main/types'
import { createTestDbWithMigrations } from '../helpers/db'

function gameTarget(game: Game): WatchTarget {
  return { kind: 'game', id: game.gameId, scope: game.league, game }
}

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(overrides: Partial<SourceAdapter> & { sourceId: string }): SourceAdapter {
  return {
    sourceId: overrides.sourceId,
    name: overrides.name ?? 'Mock',
    baseUrl: overrides.baseUrl ?? 'https://mock.test',
    classification: overrides.classification ?? 'event_first',
    supportedLeagues: overrides.supportedLeagues ?? ['nba'],
    extractionMethod: overrides.extractionMethod ?? 'network_intercept',
    confidenceWeight: overrides.confidenceWeight ?? 0.8,
    getCandidateStreams: overrides.getCandidateStreams ?? jest.fn().mockResolvedValue([]),
    getSourceHealth: overrides.getSourceHealth ?? jest.fn().mockResolvedValue('unknown'),
    getChannelStreams: overrides.getChannelStreams,
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NBA_GAME: Game = {
  gameId: 'nba_test001',
  league: 'nba',
  teamHome: 'Los Angeles Lakers',
  teamAway: 'Golden State Warriors',
  startTime: Date.now(),
  status: 'LIVE',
}

const HLS_1080P_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  'chunklist.m3u8',
].join('\n')

const HLS_720P_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
  'chunklist.m3u8',
].join('\n')

function makeRaw(overrides: Partial<RawStreamCandidate> = {}): RawStreamCandidate {
  return {
    streamUrl: 'https://cdn.example.com/stream.m3u8',
    streamType: 'hls',
    quality: null,
    extractionConfidence: 0.9,
    ...overrides,
  }
}

function makeMockFetch(manifest: string = HLS_1080P_MANIFEST) {
  return jest.fn().mockResolvedValue({
    ok: true,
    text: async () => manifest,
  }) as unknown as typeof fetch
}

function seedSource(
  db: ReturnType<typeof createTestDbWithMigrations>,
  sourceId: string,
  healthState: string = 'healthy',
  classification: string = 'event_first'
) {
  db.prepare(`
    INSERT OR REPLACE INTO sources (source_id, name, base_url, classification, supported_leagues,
      extraction_method, confidence_weight, health_state, enabled, needs_adapter,
      added_at)
    VALUES (?, ?, ?, ?, '["nba"]', 'network_intercept', 0.8, ?, 1, 0, ?)
  `).run(sourceId, `${sourceId} source`, `https://${sourceId}.test`, classification, healthState, Date.now())
}

function seedGame(db: ReturnType<typeof createTestDbWithMigrations>, gameId: string = 'nba_test001') {
  db.prepare(`
    INSERT OR IGNORE INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
    VALUES (?, 'nba', 'Los Angeles Lakers', 'Golden State Warriors', ?, 'LIVE', ?)
  `).run(gameId, Date.now(), Date.now())
}

// ---------------------------------------------------------------------------
// Tests: health filtering
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — health filtering', () => {
  it('does NOT call adapter with broken source health state', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_broken', 'broken')

    const getCandidateStreams = jest.fn().mockResolvedValue([makeRaw()])
    const adapter = createMockAdapter({ sourceId: 'src_broken', getCandidateStreams })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(getCandidateStreams).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('does NOT call adapter with blocked source health state', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_blocked', 'blocked')

    const getCandidateStreams = jest.fn().mockResolvedValue([makeRaw()])
    const adapter = createMockAdapter({ sourceId: 'src_blocked', getCandidateStreams })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(getCandidateStreams).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('calls adapter with healthy source and returns candidates', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_healthy', 'healthy')

    const adapter = createMockAdapter({
      sourceId: 'src_healthy',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.example.com/stream.m3u8' }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: confidence composition
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — confidence composition', () => {
  it('uses extractionConfidence * matcherConfidence (event_first -> matcherConfidence=1.0)', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_event', 'healthy', 'event_first')

    const adapter = createMockAdapter({
      sourceId: 'src_event',
      classification: 'event_first',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ extractionConfidence: 0.8 }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    // event_first -> matcherConfidence=1.0, so finalConfidence=0.8*1.0=0.8
    // score > 0 confirms candidate was included
    expect(results).toHaveLength(1)
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('excludes non-event_first candidate with no team name match (matcherConfidence=0)', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_mixed', 'healthy', 'mixed_aggregator')

    const adapter = createMockAdapter({
      sourceId: 'src_mixed',
      classification: 'mixed_aggregator',
      getCandidateStreams: jest.fn().mockResolvedValue([
        // URL has no team names -> matcherConfidence = 0 -> excluded
        makeRaw({ streamUrl: 'https://cdn.nomatches.com/stream.m3u8', extractionConfidence: 0.9 }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(0)
  })

  it('excludes CBB nickname-only match (matcherConfidence=0.3 < 0.5 threshold)', async () => {
    const CBB_GAME: Game = {
      gameId: 'cbb_test001',
      league: 'cbb',
      teamHome: 'Auburn Tigers',
      teamAway: 'Memphis Tigers',
      startTime: Date.now(),
      status: 'LIVE',
    }

    const db = createTestDbWithMigrations()
    db.prepare(`
      INSERT OR IGNORE INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
      VALUES ('cbb_test001', 'cbb', 'Auburn Tigers', 'Memphis Tigers', ?, 'LIVE', ?)
    `).run(Date.now(), Date.now())
    seedSource(db, 'src_cbb', 'healthy', 'mixed_aggregator')

    const adapter = createMockAdapter({
      sourceId: 'src_cbb',
      classification: 'mixed_aggregator',
      supportedLeagues: ['cbb'],
      getCandidateStreams: jest.fn().mockResolvedValue([
        // URL contains only ambiguous nickname "tigers" -> matcherConfidence=0.3 -> excluded
        makeRaw({ streamUrl: 'https://cdn.stream.com/tigers-game.m3u8', extractionConfidence: 0.9 }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(CBB_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: parallel probing
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — parallel probing', () => {
  it('probes all candidates in parallel via Promise.allSettled and returns them all', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_a', 'healthy')
    seedSource(db, 'src_b', 'healthy')

    const adapterA = createMockAdapter({
      sourceId: 'src_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8' }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'src_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8' }),
      ]),
    })

    const fetchCallUrls: string[] = []
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      fetchCallUrls.push(url)
      return Promise.resolve({
        ok: true,
        text: async () => HLS_1080P_MANIFEST,
      })
    }) as unknown as typeof fetch

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    expect(results).toHaveLength(2)
    expect(fetchCallUrls).toContain('https://cdn.a.com/stream.m3u8')
    expect(fetchCallUrls).toContain('https://cdn.b.com/stream.m3u8')
  })

  it('drops candidate where probe returns null (404 response)', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_probe_fail', 'healthy')

    const adapter = createMockAdapter({
      sourceId: 'src_probe_fail',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.fail.com/stream.m3u8' }),
      ]),
    })

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    }) as unknown as typeof fetch

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: ranking / scoring
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — ranking', () => {
  it('returns candidates sorted by score descending', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_high', 'healthy')
    seedSource(db, 'src_low', 'unknown')

    // Seed reliability for src_high: 9 successes, 1 failure -> high reliability
    db.prepare(`
      INSERT INTO source_reliability
        (source_id, league, startup_successes, startup_failures, total_startup_time_ms,
         buffer_events, switch_events, total_sessions, consecutive_failures, last_updated)
      VALUES ('src_high', 'nba', 9, 1, 90000, 0, 0, 10, 0, ?)
    `).run(Date.now())
    // No reliability for src_low -> neutral 0.5

    const adapterHigh = createMockAdapter({
      sourceId: 'src_high',
      healthState: 'healthy',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.high.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterLow = createMockAdapter({
      sourceId: 'src_low',
      healthState: 'unknown',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.low.com/stream.m3u8', extractionConfidence: 0.6 }),
      ]),
    })

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    }) as unknown as typeof fetch

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapterHigh, adapterLow]
    )

    expect(results).toHaveLength(2)
    expect(results[0].sourceId).toBe('src_high')
    expect(results[1].sourceId).toBe('src_low')
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('healthy source ranks above unknown source with equal reliability', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_h', 'healthy')
    seedSource(db, 'src_u', 'unknown')

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    }) as unknown as typeof fetch

    const adapterH = createMockAdapter({
      sourceId: 'src_h',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.h.com/stream.m3u8' }),
      ]),
    })
    const adapterU = createMockAdapter({
      sourceId: 'src_u',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.u.com/stream.m3u8' }),
      ]),
    })

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapterH, adapterU]
    )

    expect(results).toHaveLength(2)
    expect(results[0].sourceId).toBe('src_h')
    expect(results[1].sourceId).toBe('src_u')
  })
})

// ---------------------------------------------------------------------------
// Tests: error handling
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — error handling', () => {
  it('returns [] when all adapters getCandidateStreams reject (not throw)', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_err_a', 'healthy')
    seedSource(db, 'src_err_b', 'healthy')

    const adapterA = createMockAdapter({
      sourceId: 'src_err_a',
      getCandidateStreams: jest.fn().mockRejectedValue(new Error('Network error')),
    })
    const adapterB = createMockAdapter({
      sourceId: 'src_err_b',
      getCandidateStreams: jest.fn().mockRejectedValue(new Error('Timeout')),
    })
    const mockFetch = makeMockFetch()

    await expect(
      collectAndRankCandidates(gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapterA, adapterB])
    ).resolves.toEqual([])
  })

  it('returns candidates from working adapter when one adapter fails', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_ok', 'healthy')
    seedSource(db, 'src_fail', 'healthy')

    const adapterOk = createMockAdapter({
      sourceId: 'src_ok',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.ok.com/stream.m3u8' }),
      ]),
    })
    const adapterFail = createMockAdapter({
      sourceId: 'src_fail',
      getCandidateStreams: jest.fn().mockRejectedValue(new Error('Adapter failed')),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapterOk, adapterFail]
    )

    expect(results).toHaveLength(1)
    expect(results[0].sourceId).toBe('src_ok')
  })

  it('candidateId follows format sourceId_gameId_timestamp_index', async () => {
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_id_test', 'healthy')

    const adapter = createMockAdapter({
      sourceId: 'src_id_test',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.id.com/stream.m3u8' }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(1)
    expect(results[0].candidateId).toMatch(/^src_id_test_nba_test001_\d+_\d+$/)
  })

  it('gives distinct candidateIds to multiple streams from one source', async () => {
    // One source returning two streams in the same millisecond used to yield
    // identical ids, so pinning or selecting one could land on the other.
    const db = createTestDbWithMigrations()
    seedGame(db)
    seedSource(db, 'src_multi', 'healthy')

    const adapter = createMockAdapter({
      sourceId: 'src_multi',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.multi.com/a.m3u8' }),
        makeRaw({ streamUrl: 'https://cdn.multi.com/b.m3u8' }),
      ]),
    })
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      gameTarget(NBA_GAME), undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toHaveLength(2)
    expect(new Set(results.map((r) => r.candidateId)).size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tests: channel targets
// ---------------------------------------------------------------------------

describe('collectAndRankCandidates — channel targets', () => {
  const CHANNEL_TARGET: WatchTarget = {
    kind: 'channel',
    id: 'ch:espn',
    scope: 'channel',
    channel: { channelId: 'ch:espn', name: 'ESPN', category: 'sports', sourceCount: 1, lastSeenAt: Date.now() },
  }

  function makeLink(overrides: Partial<ChannelSourceLink> = {}): ChannelSourceLink {
    return {
      channelId: 'ch:espn',
      sourceId: 'src_ch',
      url: 'https://src-ch.test/espn',
      label: 'ESPN',
      seenAt: Date.now(),
      ...overrides,
    }
  }

  it('calls only adapters that have a link and implement getChannelStreams', async () => {
    const db = createTestDbWithMigrations()
    seedSource(db, 'src_ch', 'healthy', 'channel_first')
    seedSource(db, 'src_no_link', 'healthy', 'channel_first')
    seedSource(db, 'src_no_method', 'healthy', 'channel_first')

    const getChannelStreams = jest.fn().mockResolvedValue([makeRaw({ streamUrl: 'https://cdn.espn.test/stream.m3u8' })])
    const adapterWithLink = createMockAdapter({ sourceId: 'src_ch', getChannelStreams })

    // Implements getChannelStreams, but has no link for this channel.
    const adapterNoLink = createMockAdapter({
      sourceId: 'src_no_link',
      getChannelStreams: jest.fn().mockResolvedValue([makeRaw()]),
    })

    // Has a link, but does not implement getChannelStreams at all.
    const adapterNoMethod = createMockAdapter({ sourceId: 'src_no_method' })

    const linksFn = jest.fn().mockReturnValue([makeLink({ sourceId: 'src_ch' })])
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      CHANNEL_TARGET,
      undefined,
      db,
      mockFetch,
      () => [adapterWithLink, adapterNoLink, adapterNoMethod],
      linksFn
    )

    expect(getChannelStreams).toHaveBeenCalledWith('https://src-ch.test/espn', undefined)
    expect(results).toHaveLength(1)
    expect(results[0].sourceId).toBe('src_ch')
  })

  it("sets the candidate's gameId to the channel id", async () => {
    const db = createTestDbWithMigrations()
    seedSource(db, 'src_ch', 'healthy', 'channel_first')

    const adapter = createMockAdapter({
      sourceId: 'src_ch',
      getChannelStreams: jest.fn().mockResolvedValue([makeRaw({ streamUrl: 'https://cdn.espn.test/stream.m3u8' })]),
    })
    const linksFn = jest.fn().mockReturnValue([makeLink()])
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      CHANNEL_TARGET, undefined, db, mockFetch, () => [adapter], linksFn
    )

    expect(results).toHaveLength(1)
    expect(results[0].gameId).toBe('ch:espn')
  })

  it('does not call an adapter whose source is broken', async () => {
    const db = createTestDbWithMigrations()
    seedSource(db, 'src_ch', 'broken', 'channel_first')

    const getChannelStreams = jest.fn().mockResolvedValue([makeRaw()])
    const adapter = createMockAdapter({ sourceId: 'src_ch', getChannelStreams })
    const linksFn = jest.fn().mockReturnValue([makeLink()])
    const mockFetch = makeMockFetch()

    const results = await collectAndRankCandidates(
      CHANNEL_TARGET, undefined, db, mockFetch, () => [adapter], linksFn
    )

    expect(getChannelStreams).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('returns [] (not throw) when the only eligible adapter rejects', async () => {
    const db = createTestDbWithMigrations()
    seedSource(db, 'src_ch', 'healthy', 'channel_first')

    const adapter = createMockAdapter({
      sourceId: 'src_ch',
      getChannelStreams: jest.fn().mockRejectedValue(new Error('boom')),
    })
    const linksFn = jest.fn().mockReturnValue([makeLink()])
    const mockFetch = makeMockFetch()

    await expect(
      collectAndRankCandidates(CHANNEL_TARGET, undefined, db, mockFetch, () => [adapter], linksFn)
    ).resolves.toEqual([])
  })
})
