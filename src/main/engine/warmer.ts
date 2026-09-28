import type { Game, WatchTarget } from '../types'
import type { PlaywrightPool } from '../adapters/pool'
import type { SourceAdapter } from '../adapters/base'
import Database from 'better-sqlite3'
import { getStreamCandidates } from './index'
import {
  getCacheEntries,
  setCacheEntries,
  clearCacheEntries,
  clearAllCache,
} from './cache'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARM_CYCLE_MS = 150_000         // 2.5 minutes between warm cycle ticks
const WARM_STALE_MS = 150_000         // re-extract if cache older than 2.5 min
const PRE_WARM_WINDOW_MS = 10 * 60_000  // 10 minutes before start triggers pre-warm
const INITIAL_WARM_DELAY_MS = 90_000  // delay first warm cycle to avoid pool starvation on startup

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let liveGameIds = new Set<string>()
let warmInterval: ReturnType<typeof setInterval> | null = null
let warmInitTimer: ReturnType<typeof setTimeout> | null = null
const inFlight = new Set<string>()
let firstUpdateReceived = false
let warmerReady = false  // gates background extraction until initial delay elapses

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extracts stream candidates for a game and stores them in the cache.
 * Uses the in-flight guard to prevent duplicate concurrent extractions.
 */
async function extractForGame(
  game: Game,
  _priority: 'background',
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[]
): Promise<void> {
  if (inFlight.has(game.gameId)) return

  inFlight.add(game.gameId)
  try {
    // The warmer only ever pre-warms games today; channel warming lands in a
    // later task. Wrap here rather than exporting a helper nothing else needs.
    const target: WatchTarget = { kind: 'game', id: game.gameId, scope: game.league, game }
    const candidates = await getStreamCandidates(target, pool, db, fetchFn, adaptersFn)
    if (candidates.length > 0) {
      setCacheEntries(game.gameId, candidates)
    }
  } finally {
    inFlight.delete(game.gameId)
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Handles a games-updated event from the ESPN poller.
 *
 * - Detects newly LIVE games (not previously tracked) and triggers immediate extraction
 * - Clears cache for RECENTLY_ENDED games
 * - Pre-warms STARTING_SOON games within 10 minutes of their start time
 * - Updates the internal liveGameIds set
 */
export function onGamesUpdated(
  update: { games: Game[]; isStale: boolean },
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[]
): void {
  const { games } = update

  // Build current live set
  const currentLive = new Set(
    games.filter(g => g.status === 'LIVE').map(g => g.gameId)
  )

  // Cache eviction is never gated. It costs nothing, touches no pool slot, and
  // skipping it leaves entries for a finished game in the cache — so a later
  // click could be served a URL for a game that already ended. This previously
  // sat behind the first-update return along with everything else.
  for (const game of games) {
    if (game.status === 'RECENTLY_ENDED') {
      clearCacheEntries(game.gameId)
    }
  }

  // The first update is a snapshot, not a change: every live game looks "new"
  // at startup, and extracting for all of them would saturate the pool before
  // the user has clicked anything.
  const isFirstUpdate = !firstUpdateReceived
  firstUpdateReceived = true

  // warmerReady gates background extraction until startWarmer's initial delay
  // has elapsed, so the pool stays free for the user's first play(). It applies
  // to STARTING_SOON as well as LIVE — previously only LIVE was gated, which
  // let pre-warming through during exactly the window the gate exists to
  // protect.
  if (!isFirstUpdate && warmerReady) {
    for (const game of games) {
      if (game.status === 'LIVE') {
        // Newly LIVE game: trigger immediate extraction (fire-and-forget)
        if (!liveGameIds.has(game.gameId)) {
          extractForGame(game, 'background', pool, db, fetchFn, adaptersFn).catch(() => {})
        }
      } else if (game.status === 'STARTING_SOON') {
        // Pre-warm if within 10 minutes of start and not already in flight or LIVE
        const timeToStart = game.startTime - Date.now()
        if (
          timeToStart < PRE_WARM_WINDOW_MS &&
          !inFlight.has(game.gameId) &&
          !liveGameIds.has(game.gameId)
        ) {
          extractForGame(game, 'background', pool, db, fetchFn, adaptersFn).catch(() => {})
        }
      }
    }
  }

  // Update tracked live game set
  liveGameIds = currentLive
}

/**
 * Runs one warm cycle: re-extracts LIVE games whose cache entries are stale
 * (oldest validatedAt > WARM_STALE_MS ago) or missing entirely.
 *
 * @param games - Optional current game list used to look up full Game objects by gameId
 */
export async function runWarmCycle(
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[],
  games?: Game[]
): Promise<void> {
  const now = Date.now()

  for (const gameId of liveGameIds) {
    const entries = getCacheEntries(gameId)

    // Determine whether to re-extract
    let needsRefresh = false
    if (entries.length === 0) {
      needsRefresh = true
    } else {
      // Re-extract if the oldest entry's validatedAt is beyond WARM_STALE_MS
      const oldest = entries.reduce((prev, curr) =>
        curr.validatedAt < prev.validatedAt ? curr : prev
      )
      if (now - oldest.validatedAt > WARM_STALE_MS) {
        needsRefresh = true
      }
    }

    if (needsRefresh) {
      // Look up full Game object from provided games list
      const game = games?.find(g => g.gameId === gameId)
      if (game) {
        extractForGame(game, 'background', pool, db, fetchFn, adaptersFn).catch(() => {})
      }
    }
  }
}

/**
 * Opens the gate on background extraction.
 *
 * startWarmer calls this once its initial delay has elapsed. Exported so tests
 * can reach the same state directly instead of waiting on a real timer — the
 * alternative is every warming test depending on timer plumbing, which hides
 * what is actually being asserted.
 */
export function markWarmerReady(): void {
  warmerReady = true
}

/**
 * Starts the background warm cycle on a 2.5-minute interval.
 */
export function startWarmer(
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[]
): void {
  // Delay the first warm cycle so the pool is free for user-initiated play().
  // After the initial delay, enable background extraction and start the interval.
  warmInitTimer = setTimeout(() => {
    markWarmerReady()
    runWarmCycle(pool, db, fetchFn, adaptersFn)
    warmInterval = setInterval(
      () => runWarmCycle(pool, db, fetchFn, adaptersFn),
      WARM_CYCLE_MS
    )
  }, INITIAL_WARM_DELAY_MS)
}

/**
 * Stops the warm cycle interval and clears all internal state.
 */
export function stopWarmer(): void {
  if (warmInitTimer !== null) {
    clearTimeout(warmInitTimer)
    warmInitTimer = null
  }
  if (warmInterval !== null) {
    clearInterval(warmInterval)
    warmInterval = null
  }
  liveGameIds.clear()
  inFlight.clear()
  firstUpdateReceived = false
  warmerReady = false
  clearAllCache()
}

/**
 * Resets warmer internal state without clearing the cache.
 * Intended for test isolation.
 */
export function resetWarmerState(): void {
  if (warmInitTimer !== null) {
    clearTimeout(warmInitTimer)
    warmInitTimer = null
  }
  if (warmInterval !== null) {
    clearInterval(warmInterval)
    warmInterval = null
  }
  liveGameIds.clear()
  inFlight.clear()
  firstUpdateReceived = false
  warmerReady = false
}
