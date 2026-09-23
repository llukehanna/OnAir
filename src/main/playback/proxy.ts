import http from 'node:http'
import { URL } from 'node:url'
import type { BrowserContext } from 'playwright'

// ---------------------------------------------------------------------------
// Stream proxy — uses a Playwright browser context to fetch from CDNs
// that bind tokens to the browser session (cookies, TLS fingerprint).
// Plain fetch() from Node.js gets 403; routing through the browser context
// that captured the URL preserves the session state.
// ---------------------------------------------------------------------------

let server: http.Server | null = null
let proxyPort = 0
let activeCdnBase = ''
let activeCdnPath = ''
let activeContext: BrowserContext | null = null
let cachedManifest: string | null = null
let activeCdnReferer: string | null = null
let activeCdnOrigin: string | null = null

/**
 * Start the proxy for a stream URL.
 * Uses the cached manifest body (from interception) and the browser context
 * for variant playlists and segments.
 */
export async function startProxy(
  streamUrl: string,
  context: BrowserContext,
  manifestBody?: string | null,
  cdnReferer?: string | null,
  cdnOrigin?: string | null
): Promise<string> {
  const parsed = new URL(streamUrl)
  activeCdnBase = parsed.origin
  activeCdnPath = parsed.pathname + parsed.search
  activeContext = context
  cachedManifest = manifestBody ?? null
  activeCdnReferer = cdnReferer ?? null
  activeCdnOrigin = cdnOrigin ?? null
  console.log(`[proxy] manifest cached: ${!!cachedManifest}, context: ${!!context}, referer: ${activeCdnReferer}`)

  if (server && proxyPort > 0) {
    const localUrl = `http://127.0.0.1:${proxyPort}/manifest.m3u8`
    console.log(`[proxy] reusing proxy at ${localUrl}`)
    return localUrl
  }

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/manifest.m3u8' && cachedManifest) {
          // Serve the cached master manifest — don't re-fetch from CDN
          // (the token was consumed during interception).
          console.log(`[proxy] serving cached manifest (${cachedManifest.length} bytes)`)
          let text = cachedManifest
          // Rewrite URLs in manifest to point to proxy
          const lines = text.split('\n')
          const rewritten = lines.map(line => {
            const trimmed = line.trim()
            if (trimmed === '' || trimmed.startsWith('#')) {
              return trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
                if (uri.startsWith('http')) {
                  const u = new URL(uri)
                  return `URI="/cdn${u.pathname}${u.search}"`
                }
                const base = activeCdnPath.substring(0, activeCdnPath.lastIndexOf('/') + 1)
                return `URI="/cdn${base}${uri}"`
              })
            }
            if (trimmed.startsWith('http')) {
              const u = new URL(trimmed)
              return `/cdn${u.pathname}${u.search}`
            }
            const base = activeCdnPath.substring(0, activeCdnPath.lastIndexOf('/') + 1)
            return `/cdn${base}${trimmed}`
          })
          text = rewritten.join('\n')
          const buf = Buffer.from(text, 'utf8')
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': buf.length,
            'Access-Control-Allow-Origin': '*',
          })
          res.end(buf)
          return
        }

        let cdnUrl: string | undefined
        if (req.url === '/manifest.m3u8') {
          cdnUrl = activeCdnBase + activeCdnPath
        } else if (req.url?.startsWith('/cdn/')) {
          const subPath = req.url.slice(4) // strip '/cdn/'
          cdnUrl = activeCdnBase + (subPath.startsWith('/') ? '' : '/') + subPath
        } else {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        console.log(`[proxy] fetching via browser context: ${cdnUrl!.slice(0, 100)}`)

        if (!activeContext) {
          res.writeHead(503)
          res.end('No browser context')
          return
        }

        // Use the Playwright browser context to fetch — this carries cookies,
        // session state, and TLS fingerprint that the CDN expects.
        const fetchHeaders: Record<string, string> = {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        if (activeCdnReferer) fetchHeaders['Referer'] = activeCdnReferer
        if (activeCdnOrigin) fetchHeaders['Origin'] = activeCdnOrigin
        const apiRes = await activeContext.request.get(cdnUrl!, { headers: fetchHeaders })
        const status = apiRes.status()

        if (status !== 200) {
          console.log(`[proxy] CDN returned ${status} for ${cdnUrl.slice(0, 80)}`)
          res.writeHead(status)
          res.end()
          return
        }

        const contentType = apiRes.headers()['content-type'] ?? 'application/octet-stream'
        let bodyBuf = Buffer.from(await apiRes.body())

        // Rewrite m3u8 manifests to route sub-resources through proxy
        if (cdnUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
          let text = bodyBuf.toString('utf8')
          const lines = text.split('\n')
          const rewritten = lines.map(line => {
            const trimmed = line.trim()
            if (trimmed === '' || trimmed.startsWith('#')) {
              return trimmed.replace(/URI="([^"]+)"/, (_match, uri) => {
                if (uri.startsWith('http')) {
                  const u = new URL(uri)
                  return `URI="/cdn${u.pathname}${u.search}"`
                }
                const base = activeCdnPath.substring(0, activeCdnPath.lastIndexOf('/') + 1)
                return `URI="/cdn${base}${uri}"`
              })
            }
            if (trimmed.startsWith('http')) {
              const u = new URL(trimmed)
              return `/cdn${u.pathname}${u.search}`
            }
            const base = activeCdnPath.substring(0, activeCdnPath.lastIndexOf('/') + 1)
            return `/cdn${base}${trimmed}`
          })
          text = rewritten.join('\n')
          bodyBuf = Buffer.from(text, 'utf8')
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': bodyBuf.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        })
        res.end(bodyBuf)
      } catch (err) {
        console.error('[proxy] request error:', err)
        res.writeHead(502)
        res.end('Proxy error')
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      if (typeof addr === 'object' && addr) {
        proxyPort = addr.port
        const localUrl = `http://127.0.0.1:${proxyPort}/manifest.m3u8`
        console.log(`[proxy] started on port ${proxyPort}, serving ${localUrl}`)
        resolve(localUrl)
      } else {
        reject(new Error('Failed to bind proxy'))
      }
    })

    server.on('error', reject)
  })
}

export function stopProxy(): void {
  if (server) {
    server.close()
    server = null
    proxyPort = 0
    activeContext = null
    console.log('[proxy] stopped')
  }
}
