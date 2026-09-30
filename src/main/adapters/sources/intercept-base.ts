import type { Page } from 'playwright'
import type { ChannelListing, Game, HealthState, LeagueId, SourceClassification } from '../../types'
import type { RawStreamCandidate, SourceAdapter } from '../base'
import type { PlaywrightPool } from '../pool'
import { getAdRules } from '../../playback/adblock'
import { interceptStreams, isBlocked, noOpAdRules } from '../intercept'
import { matchGame } from '../../engine/matcher'
import { pickChannelLinks } from '../../channels/canonical'

// ---------------------------------------------------------------------------
// InterceptAdapter — shared base for player-page sources
//
// Most third-party sources have no API: the stream URL only exists once a
// page's JavaScript player runs. Every such source works the same way, so
// one config-driven base covers all of them:
//
//   1. Acquire a pooled page (user priority — clicks preempt background)
//   2. Navigate to the source's listing page (schedule, live-tv, matches)
//   3. Find the link whose label matches the game (engine/matcher's team
//      alias dictionary), filtered by path pattern, and follow it
//   4. Let interceptStreams() capture the .m3u8/.mpd the player requests
//   5. Report the matched listing label as matchText, so the engine's game
//      matcher scores real listing text instead of a CDN URL that never
//      names teams
//
// Adaptation per source is config, not code: which page lists the games,
// which URL paths mark a game page, and how much to trust the source.
// ---------------------------------------------------------------------------

/**
 * Path fragments that commonly mark a game/watch page on sports aggregator
 * sites. Tested against the link's *pathname*, never the full URL — a
 * hostname like streamsports99.ru must not count as a game link.
 */
export const DEFAULT_GAME_LINK_PATTERNS: readonly RegExp[] = [
  /\/(match|watch|live|stream|event|game|play|video)/i,
]

/** Default channels.linkPatterns when a source doesn't set its own. */
export const DEFAULT_CHANNEL_LINK_PATTERNS: readonly RegExp[] = [
  /\/(channel|live|tv|watch|stream)/i,
]

export interface InterceptAdapterConfig {
  readonly sourceId: string
  readonly name: string
  readonly baseUrl: string
  readonly classification: SourceClassification
  readonly supportedLeagues: LeagueId[]
  readonly confidenceWeight: number
  /** Page whose links list the source's events. Defaults to baseUrl. */
  readonly listingUrl?: string
  /**
   * Pathname patterns that mark a link as a game/watch page. Links are
   * additionally gated on their label matching the game's teams. Defaults to
   * DEFAULT_GAME_LINK_PATTERNS.
   */
  readonly gameLinkPatterns?: readonly RegExp[]
  /** Patterns identifying the source's embed player page (WebContentsView fallback). */
  readonly embedPlayerPatterns?: readonly RegExp[]
  /** Max wait for a stream manifest once on the player page (default 12s). */
  readonly interceptTimeoutMs?: number
  /** Minimum link-label match confidence to follow a listing link (default 0.5). */
  readonly matchThreshold?: number
  /**
   * Max wait for a client-rendered listing to show the game's link before
   * falling back to the listing page itself (default 5s).
   */
  readonly listingRenderTimeoutMs?: number
  /**
   * This source's 24/7 channel listing. Omit when the source has no usable
   * one (no flat page of channel links to scan) — listChannels() then always
   * returns [], same as an adapter that never implemented it.
   */
  readonly channels?: {
    readonly listUrl: string
    /** Pathname patterns marking a channel link. Defaults to DEFAULT_CHANNEL_LINK_PATTERNS. */
    readonly linkPatterns?: readonly RegExp[]
  }
}

/** A listing link that was matched to the requested game. */
export interface GameLink {
  url: string
  text: string
  /** matchGame() confidence that this link's label names the game (0-1). */
  score: number
}

interface AnchorInfo {
  url: string
  text: string
}

const LISTING_TIMEOUT_MS = 10_000

export class InterceptAdapter implements SourceAdapter {
  protected readonly config: InterceptAdapterConfig

  constructor(config: InterceptAdapterConfig) {
    this.config = config
  }

  get sourceId(): string {
    return this.config.sourceId
  }

  get name(): string {
    return this.config.name
  }

  get baseUrl(): string {
    return this.config.baseUrl
  }

  get classification(): SourceClassification {
    return this.config.classification
  }

  get supportedLeagues(): LeagueId[] {
    return this.config.supportedLeagues
  }

  get extractionMethod(): 'network_intercept' {
    return 'network_intercept'
  }

  get confidenceWeight(): number {
    return this.config.confidenceWeight
  }

  async getCandidateStreams(game: Game, pool: PlaywrightPool): Promise<RawStreamCandidate[]> {
    const listingUrl = this.config.listingUrl ?? this.config.baseUrl
    const page = await pool.acquire('user')
    try {
      // 1. Load the listing page. Never let a slow page block the pool slot.
      await page
        .goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: LISTING_TIMEOUT_MS })
        .catch(() => {})

      // A bot-challenge page has no listings to search — stop early rather
      // than burn the rest of the intercept timeout on it.
      if (await isBlocked(page).catch(() => false)) return []

      // 2. Find the game's page among the listing's links. No link means this
      //    source doesn't carry the game: stop here. Whatever the listing
      //    page's own player shows is never the game, and capturing it held a
      //    pool slot long enough to starve the sources that do carry it.
      const link = await this.findGameLink(page, game)
      if (!link) return []
      const targetUrl = link.url

      // Text for the engine matcher: the matched listing label. Without it,
      // the matcher could only score the stream URL, and CDN paths never
      // name teams.
      const matchText = link.text

      // 3. Capture the stream the player requests on the game page.
      const captured = await interceptStreams(
        page,
        targetUrl,
        getAdRules() ?? noOpAdRules,
        this.config.interceptTimeoutMs ?? 12_000,
        this.config.embedPlayerPatterns ?? []
      )
      if (!captured) return []

      // Extraction confidence is the adapter's trust in the captured stream;
      // whether it is the right game is the engine matcher's job, scored
      // against matchText above.
      return [
        {
          streamUrl: captured.streamUrl,
          streamType: 'hls',
          quality: captured.preProbed.quality,
          extractionConfidence: this.config.confidenceWeight,
          refererUrl: targetUrl,
          cdnOrigin: captured.cdnOrigin,
          cdnReferer: captured.cdnReferer,
          preProbed: captured.preProbed,
          manifestBody: captured.manifestBody,
          browserContext: captured.browserContext,
          embedPlayerUrl: captured.embedPlayerUrl,
          matchText,
        },
      ]
    } catch (err) {
      // A throw is caught upstream too, but [] is the honest answer.
      console.warn(`[${this.config.sourceId}] extraction failed:`, err)
      return []
    } finally {
      pool.release(page) // always, or the slot leaks
    }
  }

  async getSourceHealth(pool: PlaywrightPool): Promise<HealthState> {
    const page = await pool.acquire('background')
    try {
      await page
        .goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: LISTING_TIMEOUT_MS })
        .catch(() => {})

      const url = page.url()
      if (url === 'about:blank' || url.startsWith('chrome-error://')) return 'broken'
      if (await isBlocked(page).catch(() => false)) return 'blocked'

      const title = await page.title().catch(() => '')
      return title !== '' ? 'healthy' : 'degraded'
    } catch {
      return 'unknown'
    } finally {
      pool.release(page)
    }
  }

  /**
   * Lists this source's 24/7 channels, if it has a usable listing page
   * (config.channels set). Sources without one — no flat page of channel
   * links to scan — simply return [], the same result as an adapter that
   * never implemented listChannels at all.
   */
  async listChannels(pool: PlaywrightPool): Promise<ChannelListing[]> {
    const channels = this.config.channels
    if (!channels) return []

    const page = await pool.acquire('background')
    try {
      await page
        .goto(channels.listUrl, { waitUntil: 'domcontentloaded', timeout: LISTING_TIMEOUT_MS })
        .catch(() => {})

      if (await isBlocked(page).catch(() => false)) return []

      const patterns = channels.linkPatterns ?? DEFAULT_CHANNEL_LINK_PATTERNS
      // The three configured sites render their channel cards client-side,
      // after 'domcontentloaded' — scanning anchors immediately finds none.
      // Give the page a bounded chance to render them first.
      await this.waitForChannelAnchors(page, patterns)

      const anchors = await this.collectChannelAnchors(page)
      return pickChannelLinks(anchors, patterns)
    } catch (err) {
      console.warn(`[${this.config.sourceId}] listChannels failed:`, err)
      return []
    } finally {
      pool.release(page)
    }
  }

  /**
   * Extracts streams for one channel's listing url — the channel equivalent
   * of getCandidateStreams, minus the listing-page/link-matching steps
   * (the url given here already IS the target page). matchText is always
   * null: there's no game to score a listing label against.
   */
  async getChannelStreams(url: string, pool: PlaywrightPool): Promise<RawStreamCandidate[]> {
    const page = await pool.acquire('user')
    try {
      const captured = await interceptStreams(
        page,
        url,
        getAdRules() ?? noOpAdRules,
        this.config.interceptTimeoutMs ?? 12_000,
        this.config.embedPlayerPatterns ?? []
      )
      if (!captured) return []

      return [
        {
          streamUrl: captured.streamUrl,
          streamType: 'hls',
          quality: captured.preProbed.quality,
          extractionConfidence: this.config.confidenceWeight,
          refererUrl: url,
          cdnOrigin: captured.cdnOrigin,
          cdnReferer: captured.cdnReferer,
          preProbed: captured.preProbed,
          manifestBody: captured.manifestBody,
          browserContext: captured.browserContext,
          embedPlayerUrl: captured.embedPlayerUrl,
          matchText: null,
        },
      ]
    } catch (err) {
      console.warn(`[${this.config.sourceId}] getChannelStreams failed:`, err)
      return []
    } finally {
      pool.release(page)
    }
  }

  /**
   * Searches the listing page's anchors for the one naming this game.
   *
   * A candidate link must (a) have a pathname matching one of the source's
   * game-link patterns and (b) score at least matchThreshold in matchGame()
   * over its label. The best-scoring link wins; ties keep the first.
   */
  protected async findGameLink(page: Page, game: Game): Promise<GameLink | null> {
    // tvapp1.com and thetvapp.st render their game cards via JS after
    // 'domcontentloaded' — a single immediate scan sees only nav links. Poll
    // until the game's link appears, bounded so a listing that simply
    // doesn't carry the game falls through quickly.
    const deadline = Date.now() + (this.config.listingRenderTimeoutMs ?? 5_000)
    for (;;) {
      const link = await this.scanForGameLink(page, game)
      if (link !== null || Date.now() >= deadline) return link
      await page.waitForTimeout(250).catch(() => {})
    }
  }

  /** One pass of findGameLink over the anchors currently on the page. */
  protected async scanForGameLink(page: Page, game: Game): Promise<GameLink | null> {
    const patterns = this.config.gameLinkPatterns ?? DEFAULT_GAME_LINK_PATTERNS
    const threshold = this.config.matchThreshold ?? 0.5

    const anchors = await page
      .evaluate(() => {
        const out: { url: string; text: string }[] = []
        for (const node of Array.from(document.querySelectorAll('a[href]'))) {
          const el = node as HTMLAnchorElement
          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
          if (text.length < 3) continue
          // el.href is resolved absolute by the browser.
          if (el.href.startsWith('http')) out.push({ url: el.href, text })
        }
        return out
      })
      .catch(() => [] as AnchorInfo[])

    let best: GameLink | null = null
    for (const anchor of anchors ?? []) {
      let pathname: string
      try {
        pathname = new URL(anchor.url).pathname
      } catch {
        continue
      }
      if (!patterns.some((p) => p.test(pathname))) continue

      const score = matchGame(game, anchor.text)
      if (score < threshold) continue
      if (best === null || score > best.score) {
        best = { url: anchor.url, text: anchor.text, score }
      }
    }
    return best
  }

  /**
   * Bounded wait for a client-rendered channel listing: streamsports99-ru,
   * ntv-st and zlive-st all populate their channel cards via JS after the
   * page's initial HTML lands, so scanning anchors right after
   * 'domcontentloaded' finds nothing. Polls for at least one anchor whose
   * pathname matches `patterns` (up to 5s), then gives the network a further
   * chance to settle (up to another 5s) in case more cards are still
   * loading in. Never throws, never blocks the pool slot past ~10s total —
   * a source that never renders anything just falls through to an empty
   * anchor list, same as before this wait existed.
   */
  protected async waitForChannelAnchors(page: Page, patterns: readonly RegExp[]): Promise<void> {
    const pollDeadline = Date.now() + 5_000
    while (Date.now() < pollDeadline) {
      const hrefs = await page
        .evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href))
        .catch(() => [] as string[])

      const found = (hrefs ?? []).some((href) => {
        try {
          return patterns.some((p) => p.test(new URL(href).pathname))
        } catch {
          return false
        }
      })
      if (found) break

      await page.waitForTimeout(250).catch(() => {})
    }

    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  }

  /**
   * Collects {url, text} anchors for channel discovery, same shape as
   * findGameLink's extraction but with a cleaner label: a channel card's
   * name usually isn't the anchor's own textContent (that also picks up a
   * country badge, a LIVE pill, a "1 source" footer, ...) but aria-label, or
   * an h3 nested in or near the anchor. canonicalChannel needs the clean
   * name — matchGame's fuzzy scoring tolerates findGameLink's noisier text,
   * but token-exact canonicalization does not.
   */
  protected async collectChannelAnchors(page: Page): Promise<AnchorInfo[]> {
    return page
      .evaluate(() => {
        const out: { url: string; text: string }[] = []
        for (const node of Array.from(document.querySelectorAll('a[href]'))) {
          const el = node as HTMLAnchorElement
          let text: string

          const aria = el.getAttribute('aria-label')
          if (aria && aria.trim().length > 0) {
            text = aria.trim().replace(/^watch\s+/i, '')
          } else {
            let h3 = el.querySelector('h3')
            // The name element is sometimes a sibling subtree (a "watch"
            // button anchor next to a "channel-info" div), not a descendant
            // of the anchor itself — climb a few ancestors to find it.
            let ancestor: HTMLElement | null = el.parentElement
            for (let i = 0; i < 4 && ancestor && !h3; i++) {
              h3 = ancestor.querySelector('h3')
              ancestor = ancestor.parentElement
            }
            text = h3 ? (h3.textContent ?? '').trim() : (el.textContent ?? '').trim()
          }

          text = text.replace(/\s+/g, ' ')
          if (text.length === 0) continue
          if (el.href.startsWith('http')) out.push({ url: el.href, text })
        }
        return out
      })
      .catch(() => [] as AnchorInfo[])
  }
}


