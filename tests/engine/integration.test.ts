import { getStreamCandidates } from '../../src/main/engine/index'
import type { SourceAdapter, RawStreamCandidate } from '../../src/main/adapters/base'
import type { Game } from '../../src/main/types'
import { createTestDbWithMigrations } from '../helpers/db'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NBA_GAME: Game = {
  gameId: 'nba_int_test',
  league: 'nba',
  teamHome: 'Los Angeles Lakers',
  teamAway: 'Golden State Warriors',
  startTime: Date.now(),
  status: 'LIVE',
}

const MANIFEST_1080P = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  'https://cdn.a.com/1080.ts',
].join('\n')

const MANIFEST_720P = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
  'https://cdn.b.com/720.ts',
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

function createMockAdapter(overrides: Partial<SourceAdapter> & { sourceId: string }): SourceAdapter {
  return {
    sourceId: overrides.sourceId,
    name: overrides.name ?? 'Mock',
    baseUrl: overrides.baseUrl ?? `https://${overrides.sourceId}.test`,
    classification: overrides.classification ?? 'event_first',
    supportedLeagues: overrides.supportedLeagues ?? ['nba'],
    extractionMethod: overrides.extractionMethod ?? 'network_intercept',
    confidenceWeight: overrides.confidenceWeight ?? 0.8,
    getCandidateStreams: overrides.getCandidateStreams ?? jest.fn().mockResolvedValue([]),
    getSourceHealth: overrides.getSourceHealth ?? jest.fn().mockResolvedValue('unknown'),
  }
}

function seedIntegrationDb() {
  const db = createTestDbWithMigrations()

  // Seed game
  db.prepare(`
    INSERT INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
    VALUES ('nba_int_test', 'nba', 'Los Angeles Lakers', 'Golden State Warriors', ?, 'LIVE', ?)
  `).run(Date.now(), Date.now())

  // Seed source_a: healthy, event_first
  db.prepare(`
    INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
      extraction_method, confidence_weight, health_state, enabled, needs_adapter,
      added_at)
    VALUES ('source_a', 'Source A', 'https://cdn.a.com', 'event_first', '["nba"]',
      'network_intercept', 0.95, 'healthy', 1, 0, ?)
  `).run(Date.now())

  // Seed source_b: unknown health, event_first
  db.prepare(`
    INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
      extraction_method, confidence_weight, health_state, enabled, needs_adapter,
      added_at)
    VALUES ('source_b', 'Source B', 'https://cdn.b.com', 'event_first', '["nba"]',
      'network_intercept', 0.8, 'unknown', 1, 0, ?)
  `).run(Date.now())

  // Seed source_a reliability: 9 successes, 1 failure, 0 buffer events, 10 sessions, 20000ms total startup
  db.prepare(`
    INSERT INTO source_reliability
      (source_id, league, startup_successes, startup_failures, total_startup_time_ms,
       buffer_events, switch_events, total_sessions, consecutive_failures, last_updated)
    VALUES ('source_a', 'nba', 9, 1, 20000, 0, 0, 10, 0, ?)
  `).run(Date.now())
  // No reliability for source_b -> neutral 0.5 defaults

  return db
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('getStreamCandidates — full pipeline integration', () => {
  it('full pipeline returns ranked StreamCandidate[] with 2 candidates', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    const results = await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    expect(results).toHaveLength(2)
  })

  it('source_a (healthy, 90% reliability, 1080p) ranks above source_b (unknown, no history, 720p)', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    const results = await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    expect(results[0].sourceId).toBe('source_a')
    expect(results[1].sourceId).toBe('source_b')
  })

  it('quality field is populated from manifest RESOLUTION tags (1080p, 720p)', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    const results = await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    const cA = results.find(r => r.sourceId === 'source_a')
    const cB = results.find(r => r.sourceId === 'source_b')
    expect(cA?.quality).toBe('1080p')
    expect(cB?.quality).toBe('720p')
  })

  it('scores are between 0 and 1 for all candidates', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    const results = await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    for (const candidate of results) {
      expect(candidate.score).toBeGreaterThan(0)
      expect(candidate.score).toBeLessThanOrEqual(1)
    }
  })

  it('writes probe results to stream_candidates table (2 rows with probe_success=1)', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    const rows = db.prepare(
      "SELECT * FROM stream_candidates WHERE game_id = 'nba_int_test' AND probe_success = 1"
    ).all() as Array<{ probe_success: number }>

    expect(rows).toHaveLength(2)
  })

  it('writes 2 probe_result events to events table', async () => {
    const db = seedIntegrationDb()

    const adapterA = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.a.com/stream.m3u8', extractionConfidence: 0.95 }),
      ]),
    })
    const adapterB = createMockAdapter({
      sourceId: 'source_b',
      getCandidateStreams: jest.fn().mockResolvedValue([
        makeRaw({ streamUrl: 'https://cdn.b.com/stream.m3u8', extractionConfidence: 0.8 }),
      ]),
    })

    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('cdn.a.com')) {
        return Promise.resolve({ ok: true, text: async () => MANIFEST_1080P })
      }
      return Promise.resolve({ ok: true, text: async () => MANIFEST_720P })
    }) as unknown as typeof fetch

    await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapterA, adapterB]
    )

    const eventRows = db.prepare(
      "SELECT * FROM events WHERE event_type = 'probe_result'"
    ).all() as Array<{ event_type: string }>

    expect(eventRows).toHaveLength(2)
  })

  it('returns [] when adapter returns empty array', async () => {
    const db = seedIntegrationDb()

    const adapter = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockResolvedValue([]),
    })

    const mockFetch = jest.fn() as unknown as typeof fetch

    const results = await getStreamCandidates(
      NBA_GAME, undefined, db, mockFetch, () => [adapter]
    )

    expect(results).toEqual([])
  })

  it('returns [] and does not throw when adapter rejects', async () => {
    const db = seedIntegrationDb()

    const adapter = createMockAdapter({
      sourceId: 'source_a',
      getCandidateStreams: jest.fn().mockRejectedValue(new Error('Adapter threw')),
    })

    const mockFetch = jest.fn() as unknown as typeof fetch

    await expect(
      getStreamCandidates(NBA_GAME, undefined, db, mockFetch, () => [adapter])
    ).resolves.toEqual([])
  })
})
