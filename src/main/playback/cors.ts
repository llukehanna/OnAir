import { session } from 'electron'

// Active CDN headers for stream requests. Set by PlaybackManager before
// hls.js starts fetching. Cleared on stop. Main-process only — the renderer
// never sees or sets these; Electron's webRequest hooks inject them transparently.
let activeCdnOrigin: string | null = null
let activeCdnReferer: string | null = null

export function setActiveStreamHeaders(cdnOrigin: string | null, cdnReferer: string | null): void {
  console.log(`[cors] setActiveStreamHeaders origin=${cdnOrigin} referer=${cdnReferer}`)
  activeCdnOrigin = cdnOrigin
  activeCdnReferer = cdnReferer
}

export function setupCors(): void {
  // Inject CORS headers on responses so hls.js can read CDN responses.
  // Only set if the server didn't already include them — duplicate
  // Access-Control-Allow-Origin values (*, *) are rejected by browsers.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {}
    // Always force CORS headers to allow the renderer to read stream responses.
    // CDNs may send ACAO: <specific-origin> matching the original player (for
    // example the embed page), but the renderer's origin is localhost/dev server.
    // Override to * so hls.js can read manifest and segment responses.
    //
    // Important: also remove Access-Control-Allow-Credentials. Browsers reject
    // responses where ACAO is * and Allow-Credentials is true (spec violation).
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
    headers['Access-Control-Allow-Headers'] = ['*']
    // Remove any credentials headers (case-insensitive) to avoid * + credentials conflict
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'access-control-allow-credentials') {
        delete headers[key]
      }
    }
    callback({ responseHeaders: headers })
  })

  // Inject Origin + Referer on outgoing requests for stream manifests and segments.
  // CDNs validate these headers — using the wrong origin returns 403.
  // The correct values come from the actual m3u8 request intercepted by Playwright
  // (typically the iframe that hosts the player).
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    if (isStreamRequest(details.url)) {
      // Spoof a standard Chrome User-Agent on all stream requests.
      // CDNs may reject Electron's UA which contains "Electron/..." in the string.
      headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

      if (activeCdnOrigin || activeCdnReferer) {
        if (activeCdnReferer) headers['Referer'] = activeCdnReferer
        if (activeCdnOrigin) {
          headers['Origin'] = activeCdnOrigin
        } else {
          // Original request had no Origin (same-origin context in Playwright).
          delete headers['Origin']
        }
      }
    }
    callback({ requestHeaders: headers })
  })
}

function isStreamRequest(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    return /\.(m3u8|mpd|ts|m4s|key)(\?|$)/.test(pathname)
  } catch {
    return false
  }
}
