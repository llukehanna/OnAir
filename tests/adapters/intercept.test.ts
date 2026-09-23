import { isStreamManifest, isGameStream, isBlocked, noOpAdRules, AdRules } from '../../src/main/adapters/intercept'
import type { Page } from 'playwright'

// Helper to create a mock Page with controlled title() and url()
function makeMockPage(title: string, url: string): Page {
  return {
    title: () => Promise.resolve(title),
    url: () => url,
  } as unknown as Page
}

// ---------------------------------------------------------------------------
// isStreamManifest
// ---------------------------------------------------------------------------

describe('isStreamManifest', () => {
  test('returns true for plain .m3u8 URL', () => {
    expect(isStreamManifest('https://cdn.example.com/live/stream.m3u8')).toBe(true)
  })

  test('returns true for .m3u8 with query string', () => {
    expect(isStreamManifest('https://cdn.example.com/live/stream.m3u8?token=abc&expires=9999')).toBe(true)
  })

  test('returns true for .mpd URL', () => {
    expect(isStreamManifest('https://cdn.example.com/live/stream.mpd')).toBe(true)
  })

  test('returns true for .mpd with query string', () => {
    expect(isStreamManifest('https://cdn.example.com/live/stream.mpd?sid=xyz')).toBe(true)
  })

  test('returns false for .html page', () => {
    expect(isStreamManifest('https://cdn.example.com/page.html')).toBe(false)
  })

  test('returns false for .css URL', () => {
    expect(isStreamManifest('https://cdn.example.com/style.css')).toBe(false)
  })

  test('returns false for .js URL', () => {
    expect(isStreamManifest('https://cdn.example.com/app.js')).toBe(false)
  })

  test('returns false for URL with m3u8 only in query param (not path)', () => {
    // "file=stream.m3u8" appears in the query — the path is .php
    expect(isStreamManifest('https://cdn.example.com/player.php?file=stream.m3u8')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isGameStream
// ---------------------------------------------------------------------------

describe('isGameStream', () => {
  test('returns true for a clean game stream .m3u8', () => {
    expect(isGameStream('https://cdn.example.com/live/stream.m3u8')).toBe(true)
  })

  test('returns false for URL with /ads/ path segment', () => {
    expect(isGameStream('https://ads.example.com/ads/preroll.m3u8')).toBe(false)
  })

  test('returns false for URL with /ad/ path segment', () => {
    expect(isGameStream('https://cdn.example.com/ad/banner.m3u8')).toBe(false)
  })

  test('returns false for URL containing ad_stream', () => {
    expect(isGameStream('https://cdn.example.com/ad_stream/video.m3u8')).toBe(false)
  })

  test('returns false for URL containing preroll', () => {
    expect(isGameStream('https://cdn.example.com/preroll/video.m3u8')).toBe(false)
  })

  test('returns false for URL containing midroll', () => {
    expect(isGameStream('https://cdn.example.com/midroll/video.m3u8')).toBe(false)
  })

  test('returns false for doubleclick.net domain', () => {
    expect(isGameStream('https://doubleclick.net/video.m3u8')).toBe(false)
  })

  test('returns false for googlevideo.com videoplayback with ctier=L (YouTube ad)', () => {
    expect(isGameStream('https://googlevideo.com/videoplayback?ctier=L&itag=22')).toBe(false)
  })

  test('returns false for moatads.com domain', () => {
    expect(isGameStream('https://moatads.com/stream.m3u8')).toBe(false)
  })

  test('returns false for serving-sys.com domain', () => {
    expect(isGameStream('https://serving-sys.com/stream.m3u8')).toBe(false)
  })

  test('returns false for 2mdn.net domain (Google ad CDN)', () => {
    expect(isGameStream('https://2mdn.net/stream.m3u8')).toBe(false)
  })

  test('returns false for s.yimg.com domain', () => {
    expect(isGameStream('https://s.yimg.com/stream.m3u8')).toBe(false)
  })

  test('returns false for non-manifest URL even with clean path', () => {
    // isGameStream requires isStreamManifest to pass first
    expect(isGameStream('https://cdn.example.com/live/page.html')).toBe(false)
  })

  test('returns true for .m3u8 with query token on clean CDN', () => {
    expect(isGameStream('https://cdn.akamai.net/live/nba/stream.m3u8?token=abc')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isBlocked
// ---------------------------------------------------------------------------

describe('isBlocked', () => {
  test('returns true for "Just a moment..." Cloudflare challenge title', async () => {
    const page = makeMockPage('Just a moment...', 'https://example.com/')
    expect(await isBlocked(page)).toBe(true)
  })

  test('returns true for "Access Denied" title', async () => {
    const page = makeMockPage('Access Denied', 'https://example.com/')
    expect(await isBlocked(page)).toBe(true)
  })

  test('returns true for "Attention Required" title', async () => {
    const page = makeMockPage('Attention Required', 'https://example.com/')
    expect(await isBlocked(page)).toBe(true)
  })

  test('returns true when URL contains /cdn-cgi/', async () => {
    const page = makeMockPage('Loading', 'https://example.com/cdn-cgi/challenge-platform/')
    expect(await isBlocked(page)).toBe(true)
  })

  test('returns true when URL contains "challenge"', async () => {
    const page = makeMockPage('Please Wait', 'https://example.com/challenge?id=xyz')
    expect(await isBlocked(page)).toBe(true)
  })

  test('returns false for a normal page with non-blocking title and URL', async () => {
    const page = makeMockPage('NBA Streams', 'https://source-a.example/nba/401810821')
    expect(await isBlocked(page)).toBe(false)
  })

  test('is case-insensitive on title check', async () => {
    // "JUST A MOMENT..." should also match the lowercase check
    const page = makeMockPage('JUST A MOMENT...', 'https://example.com/')
    expect(await isBlocked(page)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// noOpAdRules
// ---------------------------------------------------------------------------

describe('noOpAdRules', () => {
  test('isBlocked returns false for ad CDN URL', () => {
    expect(noOpAdRules.isBlocked('https://doubleclick.net/ads/tracker.gif')).toBe(false)
  })

  test('isBlocked returns false for any URL', () => {
    expect(noOpAdRules.isBlocked('https://moatads.com/pixel.gif')).toBe(false)
    expect(noOpAdRules.isBlocked('https://cdn.example.com/stream.m3u8')).toBe(false)
    expect(noOpAdRules.isBlocked('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AdRules interface shape check (compile-time, but assert at runtime too)
// ---------------------------------------------------------------------------

describe('AdRules interface', () => {
  test('noOpAdRules satisfies AdRules interface', () => {
    // TypeScript already enforces this at compile time, but assert runtime shape
    const rules: AdRules = noOpAdRules
    expect(typeof rules.isBlocked).toBe('function')
  })

  test('custom AdRules implementation can block a URL', () => {
    const customRules: AdRules = {
      isBlocked: (url: string) => url.includes('blocked.com'),
    }
    expect(customRules.isBlocked('https://blocked.com/ad.gif')).toBe(true)
    expect(customRules.isBlocked('https://cdn.example.com/stream.m3u8')).toBe(false)
  })
})
