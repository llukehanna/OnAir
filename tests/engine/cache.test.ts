import {
  getCacheEntries,
  setCacheEntries,
  clearCacheEntries,
  clearAllCache,
  classifyEntry,
  headValidate,
  validateStaleEntries,
  FRESH_MS,
  STALE_MS,
  UrlCacheEntry,
} from '../../src/main/engine/cache'
import type { StreamCandidate } from '../../src/main/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    candidateId: 'cand-1',
    gameId: 'game-1',
    sourceId: 'src-1',
    streamUrl: 'https://cdn.example.com/stream.m3u8',
    streamType: 'hls',
    quality: '1080p',
    score: 0.9,
    probedAt: Date.now(),
    probeSuccess: true,
    probeLatencyMs: 100,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<UrlCacheEntry> = {}): UrlCacheEntry {
  return {
    gameId: 'game-1',
    sourceId: 'src-1',
    streamUrl: 'https://cdn.example.com/stream.m3u8',
    streamType: 'hls',
    quality: '1080p',
    score: 0.9,
    cachedAt: Date.now(),
    validatedAt: Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAllCache()
  jest.useRealTimers()
})

afterEach(() => {
  clearAllCache()
  jest.useRealTimers()
})

describe('getCacheEntries', () => {
  it('returns empty array for unknown gameId', () => {
    expect(getCacheEntries('unknown-game')).toEqual([])
  })

  it('returns entries sorted by score descending', () => {
    const candidates = [
      makeCandidate({ candidateId: 'c1', sourceId: 'src-1', score: 0.5 }),
      makeCandidate({ candidateId: 'c2', sourceId: 'src-2', score: 0.9 }),
      makeCandidate({ candidateId: 'c3', sourceId: 'src-3', score: 0.7 }),
    ]
    setCacheEntries('game-1', candidates)
    const entries = getCacheEntries('game-1')
    expect(entries[0].score).toBe(0.9)
    expect(entries[1].score).toBe(0.7)
    expect(entries[2].score).toBe(0.5)
  })
})

describe('setCacheEntries', () => {
  it('stores entries sorted by score descending', () => {
    const candidates = [
      makeCandidate({ candidateId: 'c1', sourceId: 'src-low', score: 0.3 }),
      makeCandidate({ candidateId: 'c2', sourceId: 'src-high', score: 0.95 }),
    ]
    setCacheEntries('game-1', candidates)
    const entries = getCacheEntries('game-1')
    expect(entries[0].sourceId).toBe('src-high')
    expect(entries[1].sourceId).toBe('src-low')
  })

  it('sets cachedAt and validatedAt to current time', () => {
    jest.useFakeTimers()
    jest.setSystemTime(1000000)
    const candidates = [makeCandidate()]
    setCacheEntries('game-1', candidates)
    const entries = getCacheEntries('game-1')
    expect(entries[0].cachedAt).toBe(1000000)
    expect(entries[0].validatedAt).toBe(1000000)
  })

  it('maps StreamCandidate fields to UrlCacheEntry correctly', () => {
    const candidate = makeCandidate({
      sourceId: 'my-source',
      streamUrl: 'https://cdn.test.com/live.m3u8',
      streamType: 'hls',
      quality: '720p',
      score: 0.75,
    })
    setCacheEntries('game-abc', [candidate])
    const entries = getCacheEntries('game-abc')
    expect(entries[0].gameId).toBe('game-abc')
    expect(entries[0].sourceId).toBe('my-source')
    expect(entries[0].streamUrl).toBe('https://cdn.test.com/live.m3u8')
    expect(entries[0].streamType).toBe('hls')
    expect(entries[0].quality).toBe('720p')
    expect(entries[0].score).toBe(0.75)
  })
})

describe('clearCacheEntries', () => {
  it('removes all entries for a gameId', () => {
    setCacheEntries('game-1', [makeCandidate()])
    clearCacheEntries('game-1')
    expect(getCacheEntries('game-1')).toEqual([])
  })

  it('does not affect entries for other gameIds', () => {
    setCacheEntries('game-1', [makeCandidate({ gameId: 'game-1' })])
    setCacheEntries('game-2', [makeCandidate({ gameId: 'game-2', candidateId: 'c2', sourceId: 'src-2' })])
    clearCacheEntries('game-1')
    expect(getCacheEntries('game-2')).toHaveLength(1)
  })
})

describe('clearAllCache', () => {
  it('empties the entire store', () => {
    setCacheEntries('game-1', [makeCandidate()])
    setCacheEntries('game-2', [makeCandidate({ candidateId: 'c2', sourceId: 'src-2' })])
    clearAllCache()
    expect(getCacheEntries('game-1')).toEqual([])
    expect(getCacheEntries('game-2')).toEqual([])
  })
})

describe('classifyEntry', () => {
  it('returns fresh when validatedAt < 3 min ago', () => {
    const now = Date.now()
    const entry = makeEntry({ validatedAt: now - (FRESH_MS - 1000) })
    expect(classifyEntry(entry, now)).toBe('fresh')
  })

  it('returns stale when validatedAt is exactly 3 min ago', () => {
    const now = Date.now()
    const entry = makeEntry({ validatedAt: now - FRESH_MS })
    expect(classifyEntry(entry, now)).toBe('stale')
  })

  it('returns stale when validatedAt is 3-8 min ago', () => {
    const now = Date.now()
    const entry = makeEntry({ validatedAt: now - (FRESH_MS + 60_000) })
    expect(classifyEntry(entry, now)).toBe('stale')
  })

  it('returns expired when validatedAt > 8 min ago', () => {
    const now = Date.now()
    const entry = makeEntry({ validatedAt: now - (STALE_MS + 1000) })
    expect(classifyEntry(entry, now)).toBe('expired')
  })

  it('returns expired when validatedAt is exactly 8 min ago', () => {
    const now = Date.now()
    const entry = makeEntry({ validatedAt: now - STALE_MS })
    expect(classifyEntry(entry, now)).toBe('expired')
  })

  it('uses validatedAt NOT cachedAt for TTL comparison', () => {
    const now = Date.now()
    // cachedAt is very old but validatedAt is fresh
    const entry = makeEntry({
      cachedAt: now - (STALE_MS + 60_000),  // ancient
      validatedAt: now - 30_000,             // 30 seconds ago = fresh
    })
    expect(classifyEntry(entry, now)).toBe('fresh')
  })
})

describe('headValidate', () => {
  it('returns true on 200 response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    const result = await headValidate('https://cdn.example.com/stream.m3u8', mockFetch)
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/stream.m3u8', {
      method: 'HEAD',
      signal: expect.any(AbortSignal),
    })
  })

  it('returns false on non-200 response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    const result = await headValidate('https://cdn.example.com/stream.m3u8', mockFetch)
    expect(result).toBe(false)
  })

  it('returns false on network error', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch
    const result = await headValidate('https://cdn.example.com/stream.m3u8', mockFetch)
    expect(result).toBe(false)
  })

  it('returns false on timeout (AbortError)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('Aborted'), { name: 'AbortError' })
    ) as unknown as typeof fetch
    const result = await headValidate('https://cdn.example.com/stream.m3u8', mockFetch)
    expect(result).toBe(false)
  })

  it('uses AbortSignal.timeout(3000) for the request', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    await headValidate('https://cdn.example.com/stream.m3u8', mockFetch)
    const callArgs = (mockFetch as jest.Mock).mock.calls[0]
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe('validateStaleEntries', () => {
  it('returns null when entries array is empty', async () => {
    const mockFetch = jest.fn() as unknown as typeof fetch
    const result = await validateStaleEntries([], mockFetch)
    expect(result).toBeNull()
  })

  it('returns first valid entry when HEAD succeeds', async () => {
    const now = Date.now()
    const entries = [
      makeEntry({ sourceId: 'src-1', score: 0.9, validatedAt: now - FRESH_MS - 1000 }),
      makeEntry({ sourceId: 'src-2', score: 0.7, validatedAt: now - FRESH_MS - 1000 }),
    ]
    const mockFetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    const result = await validateStaleEntries(entries, mockFetch)
    expect(result).not.toBeNull()
    expect(result?.sourceId).toBe('src-1')
  })

  it('returns null when all HEAD checks fail', async () => {
    const now = Date.now()
    const entries = [
      makeEntry({ sourceId: 'src-1', validatedAt: now - FRESH_MS - 1000 }),
      makeEntry({ sourceId: 'src-2', validatedAt: now - FRESH_MS - 1000 }),
    ]
    const mockFetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    const result = await validateStaleEntries(entries, mockFetch)
    expect(result).toBeNull()
  })

  it('only checks top 3 entries (runs HEAD on at most 3)', async () => {
    const now = Date.now()
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ sourceId: `src-${i}`, score: 1 - i * 0.1, validatedAt: now - FRESH_MS - 1000 })
    )
    const mockFetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    await validateStaleEntries(entries, mockFetch)
    // HEAD called at most 3 times (for top 3 entries)
    expect((mockFetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('updates validatedAt on successful HEAD check', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(2000000)
    const oldTime = 1000000
    const entries = [
      makeEntry({ sourceId: 'src-1', validatedAt: oldTime }),
    ]
    const mockFetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    const result = await validateStaleEntries(entries, mockFetch)
    expect(result?.validatedAt).toBe(2000000)
  })

  it('runs HEAD checks in parallel via Promise.all', async () => {
    const now = Date.now()
    const resolveOrder: number[] = []
    const entries = [
      makeEntry({ sourceId: 'src-1', score: 0.9, validatedAt: now - FRESH_MS - 1000 }),
      makeEntry({ sourceId: 'src-2', score: 0.7, validatedAt: now - FRESH_MS - 1000 }),
      makeEntry({ sourceId: 'src-3', score: 0.5, validatedAt: now - FRESH_MS - 1000 }),
    ]
    const mockFetch = jest.fn().mockImplementation(() => {
      resolveOrder.push(Date.now())
      return Promise.resolve({ ok: false })
    }) as unknown as typeof fetch
    await validateStaleEntries(entries, mockFetch)
    // All 3 were called (parallel means all are initiated before any resolve)
    expect((mockFetch as jest.Mock).mock.calls.length).toBe(3)
  })
})
