/**
 * adblock.test.ts
 *
 * Each describe block uses jest.isolateModules() to get a fresh module instance,
 * ensuring adRulesInstance is null at the start of each test group.
 */

import * as fs from 'fs'

jest.mock('fs')
jest.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

const mockedFs = fs as jest.Mocked<typeof fs>

// Sample EasyList content with known ad domain entries
const SAMPLE_EASYLIST = `! EasyList sample
! Version: 202403010000
||pagead2.googlesyndication.com^
||doubleclick.net^
||ads.example.com^
@@||allowedads.example.com^
! Comment line - ignored
`

const SAMPLE_EASYPRIVACY = `! EasyPrivacy sample
||analytics.example.com^
||tracking.example.com/script.js
`

function setupFreshFilesystem() {
  mockedFs.mkdirSync.mockReturnValue(undefined)
  mockedFs.existsSync.mockReturnValue(false)
  mockedFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats)
  mockedFs.writeFileSync.mockReturnValue(undefined)
  mockedFs.readFileSync.mockImplementation((filePath) => {
    const p = String(filePath)
    if (p.includes('easyprivacy')) return SAMPLE_EASYPRIVACY
    if (p.includes('easylist')) return SAMPLE_EASYLIST
    return ''
  })
}

function makeMockFetch(content = SAMPLE_EASYLIST) {
  return jest.fn().mockResolvedValue({
    ok: true,
    text: async () => content,
  })
}

// ---------------------------------------------------------------------------
// getAdRules — before init
// ---------------------------------------------------------------------------

describe('getAdRules before init', () => {
  it('returns null before initAdBlock is called', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAdRules } = require('../../src/main/playback/adblock')
      expect(getAdRules()).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// initAdBlock — post-init state
// ---------------------------------------------------------------------------

describe('initAdBlock post-init', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupFreshFilesystem()
  })

  it('after init, getAdRules() returns an object with isBlocked method', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      const rules = getAdRules()
      expect(rules).not.toBeNull()
      expect(typeof rules!.isBlocked).toBe('function')
    })
  })

  it('isBlocked returns true for pagead2.googlesyndication.com', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      const rules = getAdRules()!
      expect(rules.isBlocked('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')).toBe(true)
    })
  })

  it('isBlocked returns false for .m3u8 stream URLs', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      const rules = getAdRules()!
      expect(rules.isBlocked('https://cdn.example.com/stream/master.m3u8')).toBe(false)
    })
  })

  it('isBlocked returns false for .ts segment URLs', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      const rules = getAdRules()!
      expect(rules.isBlocked('https://cdn.example.com/segment001.ts')).toBe(false)
    })
  })

  it('isBlocked returns false for .m4s segment URLs', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      const rules = getAdRules()!
      expect(rules.isBlocked('https://cdn.example.com/init.m4s')).toBe(false)
    })
  })

  it('registers session.defaultSession.webRequest.onBeforeRequest', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // Pull the session mock from within the isolated module scope
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electronMock = require('electron')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      expect(electronMock.session.defaultSession.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1)
    })
  })

  it('onBeforeRequest callback calls cancel:true for blocked URLs', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()

      let capturedCallback: ((details: unknown, cb: (r: unknown) => void) => void) | undefined

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electronMock = require('electron')
      ;(electronMock.session.defaultSession.webRequest.onBeforeRequest as jest.Mock).mockImplementation(
        (_filter: unknown, cb: (details: unknown, callback: (r: unknown) => void) => void) => {
          capturedCallback = cb
        }
      )

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)

      expect(capturedCallback).toBeDefined()

      const result = await new Promise<Record<string, unknown>>((resolve) => {
        capturedCallback!(
          { url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js' },
          (r) => resolve(r as Record<string, unknown>)
        )
      })

      expect(result).toEqual({ cancel: true })
    })
  })

  it('onBeforeRequest callback calls {} for allowed URLs', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()

      let capturedCallback: ((details: unknown, cb: (r: unknown) => void) => void) | undefined

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electronMock = require('electron')
      ;(electronMock.session.defaultSession.webRequest.onBeforeRequest as jest.Mock).mockImplementation(
        (_filter: unknown, cb: (details: unknown, callback: (r: unknown) => void) => void) => {
          capturedCallback = cb
        }
      )

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)

      const result = await new Promise<Record<string, unknown>>((resolve) => {
        capturedCallback!(
          { url: 'https://cdn.example.com/stream/master.m3u8' },
          (r) => resolve(r as Record<string, unknown>)
        )
      })

      expect(result).toEqual({})
    })
  })

  it('uses cached filter lists from filesystem when available (does not re-download)', async () => {
    // Simulate cached files that are fresh (< 7 days old)
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.statSync.mockReturnValue({ mtimeMs: Date.now() - 1000 * 60 * 60 } as fs.Stats) // 1 hour old

    await jest.isolateModulesAsync(async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => SAMPLE_EASYLIST,
      })

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)

      // fetch should NOT have been called since cache is fresh
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// stopAdBlock
// ---------------------------------------------------------------------------

describe('stopAdBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupFreshFilesystem()
  })

  it('sets adRulesInstance back to null', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockFetch = makeMockFetch()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAdBlock, getAdRules, stopAdBlock } = require('../../src/main/playback/adblock')
      await initAdBlock('/tmp/test-userdata', mockFetch)
      expect(getAdRules()).not.toBeNull()
      stopAdBlock()
      expect(getAdRules()).toBeNull()
    })
  })
})
