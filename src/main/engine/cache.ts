import type { StreamCandidate, StreamType } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UrlCacheEntry {
  gameId: string
  /**
   * Identity of the specific stream, carried through from the candidate.
   *
   * Distinct from sourceId: one source can offer several streams for the same
   * game, and select-stream needs to pin the stream the user picked rather than
   * whichever stream that source happens to rank first. This previously did not
   * exist, so sourceId doubled as identity on the cache path.
   */
  candidateId: string
  sourceId: string
  streamUrl: string
  streamType: StreamType
  quality: string | null
  score: number
  cachedAt: number      // Unix ms — when first extracted
  validatedAt: number   // Unix ms — when last HEAD check confirmed live
  refererUrl: string | null  // Top-level page the stream was extracted from
  cdnOrigin: string | null   // Origin header CDN expects
  cdnReferer: string | null  // Referer header CDN expects
}

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

export const FRESH_MS = 3 * 60 * 1000   // 3 minutes  = 180000
export const STALE_MS = 8 * 60 * 1000   // 8 minutes  = 480000

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

const store = new Map<string, UrlCacheEntry[]>()

// ---------------------------------------------------------------------------
// Cache CRUD
// ---------------------------------------------------------------------------

/**
 * Returns cached entries for a game, sorted by score descending.
 * Returns [] when no entries exist for that gameId.
 */
export function getCacheEntries(gameId: string): UrlCacheEntry[] {
  return store.get(gameId) ?? []
}

/**
 * Converts StreamCandidate[] to UrlCacheEntry[], sets cachedAt and validatedAt
 * to current time, sorts by score descending, and stores in the map.
 */
export function setCacheEntries(gameId: string, candidates: StreamCandidate[]): void {
  const now = Date.now()
  const entries: UrlCacheEntry[] = candidates.map(c => ({
    gameId,
    // Fall back to sourceId for candidates predating candidateId, so a stale
    // cache cannot produce an entry with no identity at all.
    candidateId: c.candidateId || c.sourceId,
    sourceId: c.sourceId,
    streamUrl: c.streamUrl,
    streamType: c.streamType,
    quality: c.quality,
    score: c.score,
    cachedAt: now,
    validatedAt: now,
    refererUrl: c.refererUrl,
    cdnOrigin: c.cdnOrigin,
    cdnReferer: c.cdnReferer,
  }))
  entries.sort((a, b) => b.score - a.score)
  store.set(gameId, entries)
}

/**
 * Removes all entries for a gameId.
 */
export function clearCacheEntries(gameId: string): void {
  store.delete(gameId)
}

/**
 * Empties the entire cache store. Intended for test isolation.
 */
export function clearAllCache(): void {
  store.clear()
}

// ---------------------------------------------------------------------------
// TTL classification
// ---------------------------------------------------------------------------

/**
 * Classifies a cache entry based on its validatedAt timestamp.
 *
 * - fresh:   validatedAt < FRESH_MS (3 min) ago
 * - stale:   validatedAt between FRESH_MS and STALE_MS ago
 * - expired: validatedAt >= STALE_MS (8 min) ago
 *
 * Note: classification is based on entry.validatedAt, NOT entry.cachedAt.
 */
export function classifyEntry(entry: UrlCacheEntry, now = Date.now()): 'fresh' | 'stale' | 'expired' {
  const age = now - entry.validatedAt
  if (age < FRESH_MS) return 'fresh'
  if (age < STALE_MS) return 'stale'
  return 'expired'
}

// ---------------------------------------------------------------------------
// HEAD validation
// ---------------------------------------------------------------------------

/**
 * Sends a HEAD request to the given URL with a 3-second timeout.
 * Returns true if the response is ok (2xx), false on any error or timeout.
 */
export async function headValidate(url: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Takes up to 3 stale entries, runs HEAD validation in parallel via Promise.all,
 * returns the first entry where HEAD succeeded (updating its validatedAt),
 * or null if all fail.
 */
export async function validateStaleEntries(
  entries: UrlCacheEntry[],
  fetchFn: typeof fetch = fetch
): Promise<UrlCacheEntry | null> {
  const top3 = entries.slice(0, 3)
  if (top3.length === 0) return null

  const results = await Promise.all(
    top3.map(entry => headValidate(entry.streamUrl, fetchFn))
  )

  for (let i = 0; i < top3.length; i++) {
    if (results[i]) {
      top3[i].validatedAt = Date.now()
      return top3[i]
    }
  }

  return null
}
