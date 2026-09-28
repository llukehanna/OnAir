import type { Game, SourceClassification, LeagueId, ExtractionMethod, HealthState, StreamType } from '../types'
import type { PlaywrightPool } from './pool'
import type { BrowserContext } from 'playwright'

export interface SourceAdapter {
  readonly sourceId: string
  readonly name: string
  readonly baseUrl: string
  readonly classification: SourceClassification
  readonly supportedLeagues: LeagueId[]
  readonly extractionMethod: ExtractionMethod
  readonly confidenceWeight: number  // 0-1, adapter's self-assessed base confidence

  getCandidateStreams(game: Game, pool: PlaywrightPool): Promise<RawStreamCandidate[]>
  getSourceHealth(pool: PlaywrightPool): Promise<HealthState>
}

export interface RawStreamCandidate {
  streamUrl: string
  streamType: StreamType
  quality: string | null    // null = not known at extraction time
  extractionConfidence: number  // adapter-reported confidence (0-1)
  /** Override for the Referer header used during probing.
   *  Set this to the page URL the stream was intercepted from.
   *  Falls back to source.baseUrl when omitted. */
  refererUrl?: string
  /** The Origin header the CDN expects (from the iframe hosting the player).
   *  This is different from refererUrl which is the top-level streaming page. */
  cdnOrigin?: string | null
  /** The Referer header the CDN expects (typically the iframe origin + /). */
  cdnReferer?: string | null
  /** Human-readable text the adapter matched the game against — typically the
   *  listing link's label ("Lakers vs Celtics"). When present, the engine's
   *  game matcher scores this instead of the stream URL, whose CDN path
   *  never names teams. */
  matchText?: string | null
  /** Pre-filled probe result from Playwright session context.
   *  When set, the prober skips the plain-fetch probe and uses this directly.
   *  This is necessary because many CDNs reject plain fetches that lack
   *  the cookies/session from the original browser context. */
  preProbed?: {
    qualityScore: number
    quality: string | null
    probeLatencyMs: number
  }
  /** Browser context that captured this stream. Used by the proxy to make
   *  authenticated CDN requests with the correct cookies/session. */
  browserContext?: BrowserContext
  /** Cached manifest body from interception — avoids re-fetching from CDN. */
  manifestBody?: string | null
  /** Direct embed player URL for WebContentsView fallback. */
  embedPlayerUrl?: string | null
}
