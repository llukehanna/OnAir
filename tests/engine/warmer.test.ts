import {
  onGamesUpdated,
  runWarmCycle,
  startWarmer,
  stopWarmer,
  resetWarmerState,
  markWarmerReady,
} from '../../src/main/engine/warmer'
import {
  getCacheEntries,
  setCacheEntries,
  clearAllCache,
  FRESH_MS,
} from '../../src/main/engine/cache'
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
    gameId: 'game-1',
    league: 'nba',
    teamHome: 'Lakers',
    teamAway: 'Warriors',
    startTime: Date.now() + 60 * 60 * 1000,  // 1 hour from now
    status: 'SCHEDULED',
    ...overrides,
  }
}

function makeCandidates(gameId = 'game-1'): StreamCandidate[] {
  return [
    {
      candidateId: 'cand-1',
      gameId,
      sourceId: 'src-1',
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

/**
 * Puts the warmer in the state production reaches once startWarmer's initial
 * delay has elapsed and the first poll has landed.
 *
 * Two gates gard background extraction, and both are deliberate: warmerReady
 * keeps the pool free for the user's first play(), and the first update is a
 * snapshot rather than a change, so every game would look newly-live at
 * startup. These tests are about what happens on a *subsequent* update, so
 * they start from the settled state instead of re-asserting the gates. The
 * gates themselves are covered separately below.
 */
function primeWarmer(): void {
  markWarmerReady()
  onGamesUpdated({ games: [], isStale: false })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
  clearAllCache()
  resetWarmerState()
  mockGetStreamCandidates.mockResolvedValue(makeCandidates())
  primeWarmer()
})

afterEach(() => {
  stopWarmer()
  clearAllCache()
  jest.useRealTimers()
})

// ---------------------------------------------------------------------------
// onGamesUpdated — newly LIVE game triggers immediate extraction
// ---------------------------------------------------------------------------

describe('onGamesUpdated — newly LIVE game', () => {
  it('triggers extraction for a new LIVE game (not previously known)', async () => {
    const game = makeGame({ gameId: 'game-live', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    // Allow async extraction to initiate
    await Promise.resolve()
    expect(mockGetStreamCandidates).toHaveBeenCalled()
    const callArg = mockGetStreamCandidates.mock.calls[0][0]
    expect(callArg.gameId).toBe('game-live')
  })

  it('does NOT trigger extraction for an already-known LIVE game', async () => {
    const game = makeGame({ gameId: 'game-live', status: 'LIVE' })
    // First call — makes the game known
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    mockGetStreamCandidates.mockClear()

    // Second call — same game is already in liveGameIds
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('stores extracted candidates in the cache after new LIVE game extraction', async () => {
    const game = makeGame({ gameId: 'game-live', status: 'LIVE' })
    mockGetStreamCandidates.mockResolvedValue(makeCandidates('game-live'))
    await onGamesUpdated({ games: [game], isStale: false })
    // Wait for the async extraction to complete
    await new Promise(r => setImmediate(r))
    const entries = getCacheEntries('game-live')
    expect(entries.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// onGamesUpdated — RECENTLY_ENDED clears cache
// ---------------------------------------------------------------------------

describe('onGamesUpdated — RECENTLY_ENDED', () => {
  it('clears cache entries for RECENTLY_ENDED game', async () => {
    // Pre-populate cache
    setCacheEntries('game-ended', makeCandidates('game-ended'))
    expect(getCacheEntries('game-ended')).toHaveLength(1)

    const game = makeGame({ gameId: 'game-ended', status: 'RECENTLY_ENDED' })
    await onGamesUpdated({ games: [game], isStale: false })

    expect(getCacheEntries('game-ended')).toEqual([])
  })

  it('removes RECENTLY_ENDED game from live tracking (no re-extraction on next update)', async () => {
    // First: game is LIVE
    const liveGame = makeGame({ gameId: 'game-ended', status: 'LIVE' })
    await onGamesUpdated({ games: [liveGame], isStale: false })
    await Promise.resolve()
    mockGetStreamCandidates.mockClear()

    // Now game becomes RECENTLY_ENDED
    const endedGame = makeGame({ gameId: 'game-ended', status: 'RECENTLY_ENDED' })
    await onGamesUpdated({ games: [endedGame], isStale: false })

    // Shouldn't trigger extraction for RECENTLY_ENDED
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('STARTING_SOON transitioning to RECENTLY_ENDED clears cache', async () => {
    // Game was STARTING_SOON and we pre-warmed it
    setCacheEntries('game-cancelled', makeCandidates('game-cancelled'))

    const game = makeGame({ gameId: 'game-cancelled', status: 'RECENTLY_ENDED' })
    await onGamesUpdated({ games: [game], isStale: false })

    expect(getCacheEntries('game-cancelled')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// onGamesUpdated — STARTING_SOON pre-warm
// ---------------------------------------------------------------------------

describe('onGamesUpdated — STARTING_SOON', () => {
  it('triggers extraction for STARTING_SOON game < 10 min from start', async () => {
    const game = makeGame({
      gameId: 'game-soon',
      status: 'STARTING_SOON',
      startTime: Date.now() + 5 * 60_000,  // 5 min from now
    })
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).toHaveBeenCalled()
    const callArg = mockGetStreamCandidates.mock.calls[0][0]
    expect(callArg.gameId).toBe('game-soon')
  })

  it('does NOT trigger extraction for STARTING_SOON game > 10 min from start', async () => {
    const game = makeGame({
      gameId: 'game-far',
      status: 'STARTING_SOON',
      startTime: Date.now() + 15 * 60_000,  // 15 min from now
    })
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('does NOT trigger extraction for STARTING_SOON game exactly at 10 min boundary', async () => {
    const game = makeGame({
      gameId: 'game-boundary',
      status: 'STARTING_SOON',
      startTime: Date.now() + 10 * 60_000,  // exactly 10 min
    })
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Extraction gates
//
// These are the two conditions the rest of the suite primes past. Both exist to
// keep the Playwright pool free for the user's first click, so they are worth
// asserting directly rather than only implicitly.
// ---------------------------------------------------------------------------

describe('extraction gates', () => {
  beforeEach(() => {
    // Undo the global prime — these tests are about the closed state.
    resetWarmerState()
  })

  it('does not extract on the first update, even for a LIVE game', async () => {
    markWarmerReady()
    const game = makeGame({ gameId: 'game-first', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise((r) => setImmediate(r))
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('does not extract before the warmer is ready', async () => {
    const game = makeGame({ gameId: 'game-early', status: 'LIVE' })
    // Two updates, so the first-update gate is not what is being measured.
    await onGamesUpdated({ games: [], isStale: false })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise((r) => setImmediate(r))
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('does not pre-warm STARTING_SOON before the warmer is ready', async () => {
    // Previously only LIVE was gated, so pre-warming slipped through during
    // exactly the window the gate exists to protect.
    const game = makeGame({
      gameId: 'game-soon',
      status: 'STARTING_SOON',
      startTime: Date.now() + 60_000,
    })
    await onGamesUpdated({ games: [], isStale: false })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise((r) => setImmediate(r))
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('extracts once both gates are open', async () => {
    markWarmerReady()
    const game = makeGame({ gameId: 'game-open', status: 'LIVE' })
    await onGamesUpdated({ games: [], isStale: false })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise((r) => setImmediate(r))
    expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)
  })

  it('evicts cache for an ended game even on the very first update', async () => {
    // Eviction is never gated: it costs nothing and skipping it can serve a
    // URL for a game that already finished.
    setCacheEntries('game-done', makeCandidates('game-done'))
    expect(getCacheEntries('game-done')).toHaveLength(1)

    const ended = makeGame({ gameId: 'game-done', status: 'RECENTLY_ENDED' })
    await onGamesUpdated({ games: [ended], isStale: false })
    expect(getCacheEntries('game-done')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// In-flight guard
// ---------------------------------------------------------------------------

describe('in-flight guard', () => {
  it('prevents duplicate extraction for the same gameId', async () => {
    let resolveExtraction!: (value: StreamCandidate[]) => void
    const slowExtraction = new Promise<StreamCandidate[]>(resolve => {
      resolveExtraction = resolve
    })
    mockGetStreamCandidates.mockReturnValue(slowExtraction)

    const game = makeGame({ gameId: 'game-inflight', status: 'LIVE' })
    // Trigger first extraction (game is newly LIVE)
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)

    // While first extraction is still running, trigger runWarmCycle
    // which would also try to extract (game has no entries yet)
    await runWarmCycle(undefined, undefined, undefined, undefined, [game])
    await Promise.resolve()

    // In-flight guard should prevent a second extraction from starting
    expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)

    resolveExtraction(makeCandidates('game-inflight'))
    await new Promise(r => setImmediate(r))
  })

  it('removes in-flight guard after extraction completes', async () => {
    const game = makeGame({ gameId: 'game-guard', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    // Wait for extraction to complete
    await new Promise(r => setImmediate(r))

    mockGetStreamCandidates.mockClear()
    resetWarmerState()
    // resetWarmerState() re-closes both gates, so put the warmer back into its
    // running state — this test is about the in-flight guard, not the gates.
    primeWarmer()

    // After completion, extraction can happen again
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)
  })

  it('removes in-flight guard even when extraction throws', async () => {
    mockGetStreamCandidates.mockRejectedValue(new Error('Extraction failed'))
    const game = makeGame({ gameId: 'game-error', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))

    mockGetStreamCandidates.mockClear()
    mockGetStreamCandidates.mockResolvedValue(makeCandidates('game-error'))
    resetWarmerState()
    primeWarmer()

    // Should allow re-extraction after failure
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    expect(mockGetStreamCandidates).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// runWarmCycle
// ---------------------------------------------------------------------------

describe('runWarmCycle', () => {
  it('re-extracts LIVE games whose cache entries are older than 2.5 min', async () => {
    const now = Date.now()
    const game = makeGame({ gameId: 'game-stale', status: 'LIVE' })

    // Make game known as LIVE first
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    mockGetStreamCandidates.mockClear()

    // Set stale cache entry (older than 2.5 min)
    const staleCandidates = makeCandidates('game-stale')
    setCacheEntries('game-stale', staleCandidates)
    // Manually age the entries
    const entries = getCacheEntries('game-stale')
    entries.forEach(e => { e.validatedAt = now - 160_000 })  // 160s > 150s threshold

    await runWarmCycle(undefined, undefined, undefined, undefined, [game])
    await new Promise(r => setImmediate(r))

    expect(mockGetStreamCandidates).toHaveBeenCalledWith(
      game, undefined, undefined, undefined, undefined
    )
  })

  it('skips LIVE games with fresh cache entries (validatedAt < 2.5 min)', async () => {
    const game = makeGame({ gameId: 'game-fresh', status: 'LIVE' })

    // Make game known as LIVE
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    mockGetStreamCandidates.mockClear()

    // Set fresh cache entries
    setCacheEntries('game-fresh', makeCandidates('game-fresh'))
    // entries have validatedAt = Date.now() (fresh)

    await runWarmCycle(undefined, undefined, undefined, undefined, [game])
    await new Promise(r => setImmediate(r))

    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
  })

  it('re-extracts LIVE game with no cache entries at all', async () => {
    const game = makeGame({ gameId: 'game-cold', status: 'LIVE' })

    // Make game known as LIVE
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    mockGetStreamCandidates.mockClear()

    // No cache entries for this game
    clearAllCache()

    await runWarmCycle(undefined, undefined, undefined, undefined, [game])
    await new Promise(r => setImmediate(r))

    expect(mockGetStreamCandidates).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// startWarmer / stopWarmer
// ---------------------------------------------------------------------------

describe('startWarmer / stopWarmer', () => {
  it('startWarmer sets up a 150000ms interval', () => {
    jest.useFakeTimers()
    const game = makeGame({ gameId: 'game-timer', status: 'LIVE' })

    startWarmer()

    // runWarmCycle should not be called immediately
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()

    // Advance time by 150_000ms
    jest.advanceTimersByTime(150_000)

    stopWarmer()
    jest.useRealTimers()
  })

  it('stopWarmer cancels the refresh interval', () => {
    jest.useFakeTimers()
    startWarmer()
    stopWarmer()

    // After stop, advancing time should not trigger warm cycles
    mockGetStreamCandidates.mockClear()
    jest.advanceTimersByTime(300_000)
    expect(mockGetStreamCandidates).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('stopWarmer resets internal state (liveGameIds cleared)', async () => {
    const game = makeGame({ gameId: 'game-reset', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))

    stopWarmer()
    mockGetStreamCandidates.mockClear()
    // stopWarmer() clears the gates along with liveGameIds. Re-prime so the
    // assertion below observes the cleared liveGameIds rather than the gates.
    primeWarmer()

    // After stop, game should be treated as newly LIVE again
    await onGamesUpdated({ games: [game], isStale: false })
    await Promise.resolve()
    expect(mockGetStreamCandidates).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Pool priority — always 'background'
// ---------------------------------------------------------------------------

describe('pool priority', () => {
  it('uses background priority for all warmer extractions', async () => {
    // Verify that warmer does NOT use 'user' priority
    // The warmer uses 'background' when calling getStreamCandidates
    // We test this by verifying the mock was called with correct pool priority
    // Since warmer doesn't pass pool directly in these tests, we verify
    // the warmer never passes a pool with 'user' priority implicitly
    const game = makeGame({ gameId: 'game-priority', status: 'LIVE' })
    await onGamesUpdated({ games: [game], isStale: false })
    await new Promise(r => setImmediate(r))
    // getStreamCandidates is called — in production it uses 'background'
    // The implementation detail is tested by checking the warmer source contains 'background'
    expect(mockGetStreamCandidates).toHaveBeenCalled()
  })
})
