import {
  getCacheEntries,
  setCacheEntries,
  classifyEntry,
  validateStaleEntries,
  clearAllCache,
  FRESH_MS,
  STALE_MS,
} from '../../src/main/engine/cache'
import {
  onGamesUpdated,
  runWarmCycle,
  resetWarmerState,
  markWarmerReady,
} from '../../src/main/engine/warmer'
import type { Game, StreamCandidate } from '../../src/main/types'

// ---------------------------------------------------------------------------
// Mock getStreamCandidates
// ---------------------------------------------------------------------------

const mockGetStreamCandidates = jest.fn()

jest.mock('../../src/main/engine/index', () => ({
  getStreamCandidates: (...args: unknown[]) => mockGetStreamCandidates(...args),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    gameId: 'int-game-1',
    league: 'nba',
    teamHome: 'Lakers',
    teamAway: 'Warriors',
    startTime: Date.now(),
    status: 'LIVE',
    ...overrides,
  }
}

function makeCandidates(gameId = 'int-game-1'): StreamCandidate[] {
  return [
    {
      candidateId: 'cand-1',
      gameId,
      sourceId: 'src-a',
      streamUrl: 'https://cdn.example.com/stream.m3u8',
      streamType: 'hls',
      quality: '1080p',
      score: 0.9,
      probedAt: Date.now(),
      probeSuccess: true,
      probeLatencyMs: 100,
    },
  ]
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAllCache()
  resetWarmerState()
  mockGetStreamCandidates.mockReset()
  // Put the warmer in the state production reaches after startWarmer's initial
  // delay and the first poll. Background extraction is gated until then, so
  // without this the integration paths under test never run.
  markWarmerReady()
  onGamesUpdated({ games: [], isStale: false })
})

// ---------------------------------------------------------------------------
// Test 1: Fresh cache hit returns immediately without extraction
// ---------------------------------------------------------------------------

test('fresh cache hit: getCacheEntries returns entry, classifyEntry returns fresh', () => {
  const gameId = 'int-game-1'
  const candidates = makeCandidates(gameId)
  setCacheEntries(gameId, candidates)

  const entries = getCacheEntries(gameId)
  expect(entries).toHaveLength(1)

  // Entry should be classified as fresh (just set)
  const classification = classifyEntry(entries[0])
  expect(classification).toBe('fresh')

  // Top entry is the one with the highest score
  expect(entries[0].sourceId).toBe('src-a')
  expect(entries[0].streamUrl).toBe('https://cdn.example.com/stream.m3u8')
})

// ---------------------------------------------------------------------------
// Test 2: Stale entry triggers HEAD validation
// ---------------------------------------------------------------------------

test('stale cache entry triggers HEAD validate and returns entry', async () => {
  const gameId = 'int-game-stale'
  const candidates = makeCandidates(gameId)
  setCacheEntries(gameId, candidates)

  // Artificially age the validatedAt to stale range (4 min ago)
  const entries = getCacheEntries(gameId)
  entries[0].validatedAt = Date.now() - 4 * 60 * 1000

  // Verify classification is now stale
  expect(classifyEntry(entries[0])).toBe('stale')

  // Mock HEAD fetch returning ok
  const mockFetch = jest.fn().mockResolvedValue({ ok: true } as Response)
  const result = await validateStaleEntries(entries, mockFetch)

  expect(result).not.toBeNull()
  expect(result!.sourceId).toBe('src-a')
  // validatedAt should be updated to now
  expect(result!.validatedAt).toBeGreaterThan(Date.now() - 1000)
  expect(mockFetch).toHaveBeenCalledWith(
    'https://cdn.example.com/stream.m3u8',
    expect.objectContaining({ method: 'HEAD' })
  )
})

// ---------------------------------------------------------------------------
// Test 3: Expired entries are classified as expired (not stale or fresh)
// ---------------------------------------------------------------------------

test('expired cache entries: classifyEntry returns expired for old entries', () => {
  const gameId = 'int-game-expired'
  const candidates = makeCandidates(gameId)
  setCacheEntries(gameId, candidates)

  const entries = getCacheEntries(gameId)
  // Age the entry beyond STALE_MS (10 min ago = expired)
  entries[0].validatedAt = Date.now() - 10 * 60 * 1000

  const classification = classifyEntry(entries[0])
  expect(classification).toBe('expired')

  // No fresh or stale entries available
  const now = Date.now()
  const fresh = entries.filter(e => classifyEntry(e, now) === 'fresh')
  const stale = entries.filter(e => classifyEntry(e, now) === 'stale')
  expect(fresh).toHaveLength(0)
  expect(stale).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Test 4: onGamesUpdated + warm cycle integration
// ---------------------------------------------------------------------------

test('onGamesUpdated triggers extraction for newly LIVE game, runWarmCycle re-extracts stale', async () => {
  const game = makeGame({ gameId: 'int-warm-1', status: 'LIVE' })
  const freshCandidates = makeCandidates('int-warm-1')
  const newCandidates: StreamCandidate[] = [
    {
      ...freshCandidates[0],
      streamUrl: 'https://cdn.example.com/refresh.m3u8',
      score: 0.95,
      probedAt: Date.now(),
    }
  ]

  // First call: initial extraction when game goes LIVE
  mockGetStreamCandidates.mockResolvedValueOnce(freshCandidates)

  onGamesUpdated({ games: [game], isStale: false })

  // Wait for the fire-and-forget extraction to complete
  await new Promise(resolve => setTimeout(resolve, 50))

  // Cache should now have the initial candidates
  const entries = getCacheEntries('int-warm-1')
  expect(entries).toHaveLength(1)
  expect(entries[0].streamUrl).toBe('https://cdn.example.com/stream.m3u8')
  expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)

  // Age the cache entry beyond WARM_STALE_MS (2.5 min = stale for warm cycle)
  entries[0].validatedAt = Date.now() - 160_000 // 2min 40s ago

  // Second call: warm cycle re-extraction
  mockGetStreamCandidates.mockResolvedValueOnce(newCandidates)
  await runWarmCycle(undefined, undefined, undefined, undefined, [game])

  // Wait for fire-and-forget
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(mockGetStreamCandidates).toHaveBeenCalledTimes(2)
  const refreshed = getCacheEntries('int-warm-1')
  expect(refreshed[0].streamUrl).toBe('https://cdn.example.com/refresh.m3u8')
})

// ---------------------------------------------------------------------------
// Test 5: RECENTLY_ENDED clears cache
// ---------------------------------------------------------------------------

test('RECENTLY_ENDED game: onGamesUpdated clears its cache entries', () => {
  const gameId = 'int-ended-1'
  const candidates = makeCandidates(gameId)
  setCacheEntries(gameId, candidates)

  // Verify entries exist before the event
  expect(getCacheEntries(gameId)).toHaveLength(1)

  const game = makeGame({ gameId, status: 'RECENTLY_ENDED' })
  onGamesUpdated({ games: [game], isStale: false })

  // Cache should be cleared after RECENTLY_ENDED
  expect(getCacheEntries(gameId)).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Test 6: TTL boundary — FRESH_MS and STALE_MS edges
// ---------------------------------------------------------------------------

test('classifyEntry respects FRESH_MS and STALE_MS boundary values', () => {
  const gameId = 'int-boundary'
  const candidates = makeCandidates(gameId)
  setCacheEntries(gameId, candidates)
  const entries = getCacheEntries(gameId)
  const entry = entries[0]

  const now = Date.now()

  // Exactly at FRESH_MS boundary — should be stale (age === FRESH_MS, not < FRESH_MS)
  entry.validatedAt = now - FRESH_MS
  expect(classifyEntry(entry, now)).toBe('stale')

  // Just inside fresh — 1ms before FRESH_MS boundary
  entry.validatedAt = now - FRESH_MS + 1
  expect(classifyEntry(entry, now)).toBe('fresh')

  // Exactly at STALE_MS boundary — should be expired
  entry.validatedAt = now - STALE_MS
  expect(classifyEntry(entry, now)).toBe('expired')

  // Just inside stale — 1ms before STALE_MS boundary
  entry.validatedAt = now - STALE_MS + 1
  expect(classifyEntry(entry, now)).toBe('stale')
})
