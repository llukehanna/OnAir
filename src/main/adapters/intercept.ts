import type { Page } from 'playwright'
import { parseQuality } from '../engine/prober'

// ---------------------------------------------------------------------------
// AdRules interface and no-op stub
// ---------------------------------------------------------------------------

/**
 * Interface for ad-blocking rule engines.
 * noOpAdRules for tests; playback/adblock.ts provides the EasyList engine.
 */
export interface AdRules {
  isBlocked(url: string): boolean
}

/** No-op stub — never blocks any URL. */
export const noOpAdRules: AdRules = { isBlocked: () => false }

// ---------------------------------------------------------------------------
// Ad patterns used by isGameStream
// ---------------------------------------------------------------------------

const adPatterns: RegExp[] = [
  /\/ads?\//i,
  /ad_stream/i,
  /preroll/i,
  /midroll/i,
  /doubleclick\.net/i,
  /googlevideo\.com\/videoplayback.*ctier=L/i,
  /moatads\.com/i,
  /serving-sys\.com/i,
  /2mdn\.net/i,
  /s\.yimg\.com/i,
]

// ---------------------------------------------------------------------------
// isStreamManifest
// ---------------------------------------------------------------------------

/**
 * Returns true if the URL path ends with .m3u8 or .mpd (with optional query string).
 *
 * Note: matches only when the extension appears in the URL *path* segment, not
 * merely as a query parameter value (e.g., "?file=stream.m3u8" does not match).
 */
export function isStreamManifest(url: string): boolean {
  // Strip query string and fragment before checking extension
  try {
    const { pathname } = new URL(url)
    return /\.(m3u8|mpd)$/.test(pathname)
  } catch {
    // Fall back to regex if URL is malformed
    return /\.(m3u8|mpd)(\?|#|$)/.test(url)
  }
}

// ---------------------------------------------------------------------------
// isGameStream
// ---------------------------------------------------------------------------

/**
 * Returns true if the URL is a stream manifest AND does not match any known
 * ad CDN pattern.  This is used to distinguish game streams from ad pre-rolls
 * when multiple .m3u8 requests fire on the same page.
 */
export function isGameStream(url: string): boolean {
  if (!isStreamManifest(url)) return false
  return !adPatterns.some((p) => p.test(url))
}

// ---------------------------------------------------------------------------
// isBlocked
// ---------------------------------------------------------------------------

/**
 * Checks whether the current page has been blocked by a bot-detection system
 * (typically Cloudflare or similar WAF).
 *
 * Checks:
 *  1. Page title contains known challenge phrases (case-insensitive)
 *  2. Page URL contains '/cdn-cgi/' (Cloudflare challenge endpoint)
 *  3. Page URL contains 'challenge'
 */
export async function isBlocked(page: Page): Promise<boolean> {
  const title = (await page.title()).toLowerCase()
  const url = page.url()

  // Silent redirect to about:blank or chrome-error = bot detection
  if (url === 'about:blank' || url.startsWith('chrome-error://')) return true

  const blockingTitles = ['just a moment', 'access denied', 'attention required']
  if (blockingTitles.some((phrase) => title.includes(phrase))) return true
  if (url.includes('/cdn-cgi/')) return true
  if (url.includes('challenge')) return true

  return false
}

// ---------------------------------------------------------------------------
// interceptStreams
// ---------------------------------------------------------------------------

/**
 * Registers a single unified page.route() handler that:
 *  - Captures the first game-stream .m3u8/mpd URL and resolves the promise
 *  - Continues all manifest requests (never abort — aborting mid-stream crashes players)
 *  - Aborts ad network requests identified by adRules
 *  - Continues all other requests
 *
 * After registering the handler, navigates to targetUrl with domcontentloaded
 * (never networkidle — ad-heavy pages never reach networkidle).
 *
 * Returns the captured stream URL, or null if timeoutMs elapses without a
 * game-stream manifest being intercepted.
 *
 * IMPORTANT: Only ever register ONE page.route() handler per page. Playwright
 * only invokes the most recently registered handler, so multiple handlers
 * silently drop earlier registrations.
 *
 * @param page       - Playwright Page from PlaywrightPool.acquire()
 * @param targetUrl  - URL to navigate to
 * @param adRules    - Ad-blocking rule engine (noOpAdRules to disable)
 * @param timeoutMs  - Max milliseconds to wait for a game stream after navigation (default 12_000)
 * @param embedPlayerPatterns - URL patterns for the source's embed player page (WebContentsView fallback)
 */
export interface InterceptResult {
  streamUrl: string
  /** The Origin header the CDN expects on stream requests (from the iframe that hosts the player). */
  cdnOrigin: string | null
  /** The Referer header the CDN expects on stream requests. */
  cdnReferer: string | null
  preProbed: {
    qualityScore: number
    quality: string | null
    probeLatencyMs: number
  }
  /** Browser context from the page that captured this stream. */
  browserContext: import('playwright').BrowserContext
  /** Cached manifest body — avoids re-fetching from CDN (token may be single-use). */
  manifestBody: string | null
  /** Direct embed-player URL, used by the WebContentsView fallback tier. */
  embedPlayerUrl: string | null
}

export async function interceptStreams(
  page: Page,
  targetUrl: string,
  adRules: AdRules,
  timeoutMs = 12_000,
  /**
   * URL patterns that identify the source's embedded player page. Each adapter
   * knows its own; a match is kept as the WebContentsView fallback target.
   */
  embedPlayerPatterns: readonly RegExp[] = []
): Promise<InterceptResult | null> {
  let resolveCapture: ((data: { url: string; origin: string | null; referer: string | null; manifestBody: string | null }) => void) | null = null

  const capturePromise = new Promise<{ url: string; origin: string | null; referer: string | null; manifestBody: string | null }>((resolve) => {
    resolveCapture = resolve
  })

  // Capture the embed player URL for the WebContentsView fallback
  let embedPlayerUrl: string | null = null

  // Unroute previous handlers on both page and context to prevent accumulation.
  // Each pool page has its own browser context, so context.unrouteAll() is safe.
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  await page.context().unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})

  // Use context-level routing to capture Web Worker / Partytown requests in addition
  // to main-thread requests. page.route() misses worker requests entirely.
  await page.context().route('**', async (route) => {
    const url = route.request().url()

    // Log all requests for diagnostics (remove once stream URL pattern is confirmed)
    if (!url.startsWith('data:') && !url.includes('google') && !url.includes('analytics') && !url.includes('facebook')) {
      console.log(`[intercept] req ${url}`)
    }

    // 1. Stream manifests: capture if it's a game stream
    if (isStreamManifest(url)) {
      console.log(`[intercept] manifest url=${url} isGame=${isGameStream(url)}`)
      if (isGameStream(url) && resolveCapture !== null) {
        const headers = route.request().headers()
        // Let the request through — the page's player needs the manifest.
        // We'll capture the response body via page.on('response') listener.
        await route.continue()
        resolveCapture({
          url,
          origin: headers['origin'] ?? null,
          referer: headers['referer'] ?? null,
          manifestBody: null, // Filled by response listener below
        })
        resolveCapture = null
        return
      }
      await route.continue()
      return
    }

    // 2. Ad network URLs: abort
    if (adRules.isBlocked(url)) {
      await route.abort()
      return
    }

    // 3. Capture embed player URLs for WebContentsView fallback
    if (!embedPlayerUrl && embedPlayerPatterns.some((pattern) => pattern.test(url))) {
      embedPlayerUrl = url
      console.log(`[intercept] captured embed player URL: ${url}`)
    }

    // 4. Everything else: continue
    await route.continue()
  })

  // Navigate with a tight timeout — the route handler captures the .m3u8 as
  // soon as it fires, regardless of whether domcontentloaded finishes.
  // Don't let slow pages block the pool slot.
  const gotoTimeout = Math.min(timeoutMs, 8_000)
  console.log(`[intercept] navigating to ${targetUrl}`)
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeout }).catch(() => {})

  // Fire-and-forget play button click after 2s — don't await, let it run alongside the capture race.
  page.waitForTimeout(2000).then(async () => {
    try {
      await page.evaluate(() => {
        for (const sel of ['[class*="play"]', '[id*="play"]', '.jw-icon-play', '.vjs-play-control', 'video']) {
          const el = document.querySelector(sel) as HTMLElement | null
          if (el) { el.click(); break }
        }
      })
    } catch { /* ignore */ }
  }).catch(() => {})

  // Race: first captured game-stream URL OR timeout
  const captured = await Promise.race([
    capturePromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])

  console.log(`[intercept] result=${captured?.url ?? 'null (timeout)'} for ${targetUrl}`)
  if (!captured) return null

  const { url: streamUrl, origin: cdnOrigin, referer: cdnReferer } = captured

  // Wait for the response body — the route.continue() let the request through,
  // and the response should arrive shortly. Use waitForResponse to capture it.
  let manifestBody: string | null = null
  try {
    const response = await page.waitForResponse(
      resp => resp.url() === streamUrl,
      { timeout: 3000 }
    )
    console.log(`[intercept] manifest response status=${response.status()} for ${streamUrl.slice(0, 60)}`)
    const body = await response.body()
    const text = body.toString('utf8')
    if (text.startsWith('#EXTM3U') || text.includes('#EXTINF')) {
      manifestBody = text
      console.log(`[intercept] captured manifest response body (${text.length} bytes)`)
    }
  } catch {
    console.log(`[intercept] could not capture manifest response body for ${streamUrl.slice(0, 60)}`)
  }
  console.log(`[intercept] CDN headers: origin=${cdnOrigin} referer=${cdnReferer} manifestCached=${!!manifestBody}`)

  // Parse quality from cached manifest if available
  let quality: string | null = null
  let qualityScore = 0.75
  if (manifestBody) {
    const parsed = parseQuality(manifestBody)
    quality = parsed.label
    qualityScore = parsed.score
  }

  return { streamUrl, cdnOrigin, cdnReferer, preProbed: { qualityScore, quality, probeLatencyMs: 0 }, browserContext: page.context(), manifestBody, embedPlayerUrl }
}
