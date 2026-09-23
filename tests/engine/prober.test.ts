import { parseQuality, probeCandidate } from '../../src/main/engine/prober'
import type { ProbeInput } from '../../src/main/engine/prober'
import type { RawStreamCandidate } from '../../src/main/adapters/base'
import { createTestDbWithMigrations } from '../helpers/db'

// ---------------------------------------------------------------------------
// parseQuality tests
// ---------------------------------------------------------------------------

describe('parseQuality', () => {
  it('returns 1080p for RESOLUTION=1920x1080', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.9, label: '1080p' })
  })

  it('returns 720p for RESOLUTION=1280x720', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.75, label: '720p' })
  })

  it('returns 480p for RESOLUTION=854x480', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.55, label: '480p' })
  })

  it('returns 2160p for RESOLUTION=3840x2160', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=15000000,RESOLUTION=3840x2160\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 1.0, label: '2160p' })
  })

  it('returns 360p label for RESOLUTION=640x360', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.35, label: '360p' })
  })

  it('picks highest resolution when multiple RESOLUTION lines present (1080+720 -> 1080p)', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
      'stream-720.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
      'stream-1080.m3u8',
    ].join('\n')
    expect(parseQuality(manifest)).toEqual({ score: 0.9, label: '1080p' })
  })

  it('falls back to BANDWIDTH score when no RESOLUTION tag present', () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000\nstream.m3u8\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.75, label: null })
  })

  it('returns default score 0.5 and null label when no RESOLUTION or BANDWIDTH tags', () => {
    const manifest = '#EXTM3U\n#EXTINF:10,\nsegment.ts\n'
    expect(parseQuality(manifest)).toEqual({ score: 0.5, label: null })
  })
})

// ---------------------------------------------------------------------------
// probeCandidate tests with mock fetch
// ---------------------------------------------------------------------------

const HLS_1080P_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  'chunklist.m3u8',
].join('\n')

function makeRaw(overrides: Partial<RawStreamCandidate> = {}): RawStreamCandidate {
  return {
    streamUrl: 'https://cdn.example.com/stream/master.m3u8',
    streamType: 'hls',
    quality: null,
    extractionConfidence: 0.9,
    ...overrides,
  }
}

function makeInput(overrides: Partial<ProbeInput> = {}): ProbeInput {
  return {
    gameId: 'test_game',
    sourceId: 'test_source',
    sourceDomain: 'https://source-a.example',
    raw: makeRaw(),
    ...overrides,
  }
}

describe('probeCandidate - mock fetch', () => {
  it('returns ProbeResult with quality 1080p on successful 200 fetch', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    const result = await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)
    expect(result).not.toBeNull()
    expect(result!.quality).toBe('1080p')
    expect(result!.qualityScore).toBe(0.9)
    expect(result!.probeSuccess).toBe(true)
    expect(result!.streamUrl).toBe('https://cdn.example.com/stream/master.m3u8')
    expect(result!.streamType).toBe('hls')
    expect(typeof result!.probeLatencyMs).toBe('number')
  })

  it('returns null on non-200 response (candidate dropped)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })

    const result = await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)
    expect(result).toBeNull()
  })

  it('returns null on AbortError timeout (candidate dropped)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    )

    const result = await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)
    expect(result).toBeNull()
  })

  it('sends User-Agent, Accept, and Referer headers', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [_url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('Mozilla')
    expect(headers['Accept']).toBeDefined()
    expect(headers['Referer']).toBe('https://source-a.example')
  })

  it('passes AbortSignal to fetch call', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)

    const [_url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.signal).toBeDefined()
  })

  it('uses GET method (not HEAD)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)

    const [_url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.method).toBe('GET')
  })
})

// ---------------------------------------------------------------------------
// probeCandidate DB write tests with in-memory SQLite
// ---------------------------------------------------------------------------

describe('probeCandidate - DB writes', () => {
  function seedDb(db: ReturnType<typeof createTestDbWithMigrations>) {
    db.prepare(`
      INSERT INTO games (game_id, league, team_home, team_away, start_time, status, cached_at)
      VALUES ('test_game', 'nba', 'Lakers', 'Warriors', ${Date.now()}, 'LIVE', ${Date.now()})
    `).run()
    db.prepare(`
      INSERT INTO sources (source_id, name, base_url, classification, supported_leagues,
        extraction_method, confidence_weight, health_state, enabled, needs_adapter,
        added_at)
      VALUES ('test_source', 'Test Source', 'https://test.example.com', 'event_first', '["nba"]',
        'network_intercept', 0.8, 'healthy', 1, 0, ${Date.now()})
    `).run()
  }

  it('writes 1 row to stream_candidates with probe_success=1 on successful probe', async () => {
    const db = createTestDbWithMigrations()
    seedDb(db)

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch, db)

    const rows = db.prepare('SELECT * FROM stream_candidates WHERE game_id = ?').all('test_game') as Array<{
      probe_success: number
      quality: string | null
      stream_url: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].probe_success).toBe(1)
    expect(rows[0].quality).toBe('1080p')
    expect(rows[0].stream_url).toBe('https://cdn.example.com/stream/master.m3u8')
  })

  it('writes 1 row to stream_candidates with probe_success=0 on failed probe', async () => {
    const db = createTestDbWithMigrations()
    seedDb(db)

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch, db)

    const rows = db.prepare('SELECT * FROM stream_candidates WHERE game_id = ?').all('test_game') as Array<{
      probe_success: number
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].probe_success).toBe(0)
  })

  it('writes 1 row to events table with event_type=probe_result', async () => {
    const db = createTestDbWithMigrations()
    seedDb(db)

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await probeCandidate(makeInput(), mockFetch as unknown as typeof fetch, db)

    const rows = db.prepare("SELECT * FROM events WHERE event_type = 'probe_result'").all() as Array<{
      event_type: string
      game_id: string | null
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe('probe_result')
    expect(rows[0].game_id).toBe('test_game')
  })

  it('skips DB writes when no db parameter provided', async () => {
    // Should not throw — db is optional
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => HLS_1080P_MANIFEST,
    })

    await expect(
      probeCandidate(makeInput(), mockFetch as unknown as typeof fetch)
    ).resolves.not.toBeNull()
  })
})
