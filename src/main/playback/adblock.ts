import * as fs from 'fs'
import * as path from 'path'
import { app, session } from 'electron'
import type { AdRules } from '../adapters/intercept'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_LISTS = [
  { url: 'https://easylist.to/easylist/easylist.txt', filename: 'easylist.txt' },
  { url: 'https://easylist.to/easylist/easyprivacy.txt', filename: 'easyprivacy.txt' },
]

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** Stream segment extensions — NEVER blocked regardless of EasyList rules */
const STREAM_EXTENSIONS = /\.(m3u8|mpd|ts|m4s)(\?|$)/i

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let adRulesInstance: AdRules | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Returns the current AdRules instance, or null if initAdBlock() has not
 * yet completed. Callers should use `getAdRules() ?? noOpAdRules`.
 */
export function getAdRules(): AdRules | null {
  return adRulesInstance
}

/**
 * Downloads/caches EasyList and EasyPrivacy filter lists, parses domain rules,
 * sets up an AdRules instance, and registers session.webRequest.onBeforeRequest.
 *
 * Gracefully degrades — getAdRules() returns null until this resolves.
 *
 * @param userDataPath - Override for app.getPath('userData') (injectable for tests)
 * @param fetchFn      - Override for global fetch (injectable for tests)
 */
export async function initAdBlock(
  userDataPath?: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const dataDir = userDataPath ?? app.getPath('userData')
  const cacheDir = path.join(dataDir, 'filterlists')

  fs.mkdirSync(cacheDir, { recursive: true })

  const allLines: string[] = []

  for (const list of FILTER_LISTS) {
    const cachePath = path.join(cacheDir, list.filename)
    const isCached = fs.existsSync(cachePath)
    const isFresh = isCached && Date.now() - fs.statSync(cachePath).mtimeMs < SEVEN_DAYS_MS

    if (isFresh) {
      // Read from disk cache
      const content = fs.readFileSync(cachePath, 'utf8')
      allLines.push(...content.split('\n'))
    } else {
      // Fetch from network and write to disk
      try {
        const response = await fetchFn(list.url)
        if (response.ok) {
          const content = await response.text()
          fs.writeFileSync(cachePath, content, 'utf8')
          allLines.push(...content.split('\n'))
        }
      } catch {
        // If fetch fails and we have stale cache, use it
        if (isCached) {
          const content = fs.readFileSync(cachePath, 'utf8')
          allLines.push(...content.split('\n'))
        }
      }
    }
  }

  // Parse ||domain^ rules into a Set of blocked domains, and ||domain/path
  // rules into per-host path prefixes. A path rule must never block its whole
  // host: ||embed.st/ad.html once took down TheTVApp's entire player.
  const blockedDomains = new Set<string>()
  const blockedPaths = new Map<string, string[]>()

  for (const line of allLines) {
    const trimmed = line.trim()

    // Skip empty lines, comments, and exception rules (@@)
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('@@')) continue

    // A $domain= rule only applies on the sites it names — applying it
    // everywhere (||b-cdn.net^$domain=bunkr.cr|...) blocks shared CDNs that
    // players need. We don't track the page a request came from, so skip it.
    const optionsAt = trimmed.indexOf('$')
    if (optionsAt !== -1 && /(^|,)domain=/.test(trimmed.slice(optionsAt + 1))) continue

    // ||domain^ (most common EasyList entry), with nothing after but options
    const domainCaretMatch = trimmed.match(/^\|\|([a-zA-Z0-9._-]+)\^(\$|$)/)
    if (domainCaretMatch) {
      blockedDomains.add(domainCaretMatch[1])
      continue
    }

    // ||domain/path — block the literal path prefix, up to any wildcard
    const domainPathMatch = trimmed.match(/^\|\|([a-zA-Z0-9._-]+)(\/[^*^$|]*)/)
    if (domainPathMatch) {
      const [, host, pathPrefix] = domainPathMatch
      const prefixes = blockedPaths.get(host) ?? []
      prefixes.push(pathPrefix)
      blockedPaths.set(host, prefixes)
    }
  }

  // Build the AdRules implementation
  adRulesInstance = {
    isBlocked(url: string): boolean {
      // NEVER block stream segments — critical to prevent mid-stream CDN kills
      if (STREAM_EXTENSIONS.test(url)) return false

      try {
        const { hostname, pathname } = new URL(url)
        // Check exact match and parent domains
        const parts = hostname.split('.')
        for (let i = 0; i < parts.length - 1; i++) {
          const domain = parts.slice(i).join('.')
          if (blockedDomains.has(domain)) return true
          if (blockedPaths.get(domain)?.some((prefix) => pathname.startsWith(prefix))) return true
        }
        return false
      } catch {
        return false
      }
    },
  }

  // Register session filter
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      if (adRulesInstance && adRulesInstance.isBlocked(details.url)) {
        callback({ cancel: true })
      } else {
        callback({})
      }
    }
  )

  // Schedule weekly refresh
  refreshTimer = setInterval(
    () => {
      initAdBlock(userDataPath, fetchFn).catch(() => {
        // Ignore refresh errors — existing rules remain active
      })
    },
    SEVEN_DAYS_MS
  )
  // Prevent the timer from keeping the process alive
  if (refreshTimer.unref) refreshTimer.unref()
}

/**
 * Clears the AdRules instance back to null and stops the refresh timer.
 * After calling this, getAdRules() returns null until initAdBlock() is called again.
 */
export function stopAdBlock(): void {
  adRulesInstance = null
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}
