import { startHlsFixture, type HlsFixture } from '../../src/main/dev/hls-fixture'

// ---------------------------------------------------------------------------
// The failure-injection HLS fixture is the foundation of every failover test.
// If it lies about a failure mode, every assertion built on it is worthless —
// so it gets its own coverage.
// ---------------------------------------------------------------------------

describe('HLS failure fixture', () => {
  let fx: HlsFixture

  beforeEach(async () => {
    fx = await startHlsFixture()
  })

  afterEach(async () => {
    await fx.close()
  })

  // -- playlists ------------------------------------------------------------

  it('serves a master playlist advertising one variant', async () => {
    const res = await fetch(fx.masterUrl)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('#EXTM3U')
    expect(body).toContain('#EXT-X-STREAM-INF')
    expect(body).toContain('media.m3u8')
  })

  it('serves the master playlist as an HLS content type', async () => {
    const res = await fetch(fx.masterUrl)
    expect(res.headers.get('content-type')).toContain('mpegurl')
  })

  it('serves a live media playlist with a media sequence and segments', async () => {
    const body = await (await fetch(fx.mediaUrl)).text()
    expect(body).toContain('#EXT-X-MEDIA-SEQUENCE:0')
    expect(body).toContain('#EXTINF:')
    expect(body).toContain('.ts')
  })

  it('omits EXT-X-ENDLIST so the playlist reads as live, not VOD', async () => {
    const body = await (await fetch(fx.mediaUrl)).text()
    expect(body).not.toContain('#EXT-X-ENDLIST')
  })

  it('advertises exactly windowSize segments', async () => {
    const fixture = await startHlsFixture({ windowSize: 3 })
    try {
      const body = await (await fetch(fixture.mediaUrl)).text()
      expect(body.match(/\.ts/g)).toHaveLength(3)
    } finally {
      await fixture.close()
    }
  })

  // -- live edge advancement ------------------------------------------------

  it('advances the media sequence when advance() is called', async () => {
    expect(fx.mediaSequence).toBe(0)
    fx.advance()
    expect(fx.mediaSequence).toBe(1)
    const body = await (await fetch(fx.mediaUrl)).text()
    expect(body).toContain('#EXT-X-MEDIA-SEQUENCE:1')
  })

  it('advances by an explicit count', () => {
    fx.advance(5)
    expect(fx.mediaSequence).toBe(5)
  })

  it('rolls the segment window forward so segment names change', async () => {
    const before = await (await fetch(fx.mediaUrl)).text()
    fx.advance(3)
    const after = await (await fetch(fx.mediaUrl)).text()
    expect(after).not.toBe(before)
  })

  it('does not advance on its own — time is test-driven, not wall-clock', async () => {
    const first = await (await fetch(fx.mediaUrl)).text()
    await new Promise((r) => setTimeout(r, 50))
    const second = await (await fetch(fx.mediaUrl)).text()
    expect(second).toBe(first)
  })

  // -- program date time ----------------------------------------------------

  it('omits EXT-X-PROGRAM-DATE-TIME by default', async () => {
    const body = await (await fetch(fx.mediaUrl)).text()
    expect(body).not.toContain('#EXT-X-PROGRAM-DATE-TIME')
  })

  it('emits EXT-X-PROGRAM-DATE-TIME when requested, for continuity tests', async () => {
    const fixture = await startHlsFixture({ programDateTime: true, startDate: '2026-08-14T00:00:00.000Z' })
    try {
      const body = await (await fetch(fixture.mediaUrl)).text()
      expect(body).toContain('#EXT-X-PROGRAM-DATE-TIME:2026-08-14T00:00:00.000Z')
    } finally {
      await fixture.close()
    }
  })

  // -- healthy --------------------------------------------------------------

  it('serves segments with 200 in healthy mode', async () => {
    const res = await fetch(fx.segmentUrl(0))
    expect(res.status).toBe(200)
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  // -- segment-403 (token expiry) -------------------------------------------

  it('returns 403 on segments in segment-403 mode', async () => {
    fx.setMode('segment-403')
    expect((await fetch(fx.segmentUrl(0))).status).toBe(403)
  })

  it('keeps the manifest reachable in segment-403 mode — only segments fail', async () => {
    fx.setMode('segment-403')
    expect((await fetch(fx.mediaUrl)).status).toBe(200)
  })

  // -- manifest-404 (source gone) -------------------------------------------

  it('returns 404 on the media playlist in manifest-404 mode', async () => {
    fx.setMode('manifest-404')
    expect((await fetch(fx.mediaUrl)).status).toBe(404)
  })

  // -- off-air (200 but frozen) ---------------------------------------------

  it('freezes the media sequence in off-air mode even when advance() is called', async () => {
    fx.setMode('off-air')
    const before = await (await fetch(fx.mediaUrl)).text()
    fx.advance(4)
    const after = await (await fetch(fx.mediaUrl)).text()
    expect(after).toBe(before)
  })

  it('still returns 200 in off-air mode — the failure is invisible to HTTP', async () => {
    fx.setMode('off-air')
    expect((await fetch(fx.mediaUrl)).status).toBe(200)
    expect((await fetch(fx.segmentUrl(0))).status).toBe(200)
  })

  // -- slow -----------------------------------------------------------------

  it('delays segments in slow mode', async () => {
    const fixture = await startHlsFixture({ slowDelayMs: 120 })
    try {
      fixture.setMode('slow')
      const started = Date.now()
      await fetch(fixture.segmentUrl(0))
      expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    } finally {
      await fixture.close()
    }
  })

  // -- stall ----------------------------------------------------------------

  it('never responds to segment requests in stall mode', async () => {
    fx.setMode('stall')
    const ac = new AbortController()
    const pending = fetch(fx.segmentUrl(0), { signal: ac.signal })
    const timedOut = await Promise.race([
      pending.then(() => false).catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), 150)),
    ])
    ac.abort()
    await pending.catch(() => {})
    expect(timedOut).toBe(true)
  })

  it('keeps the manifest advancing in stall mode — the live edge moves, the buffer starves', async () => {
    fx.setMode('stall')
    fx.advance(2)
    const body = await (await fetch(fx.mediaUrl)).text()
    expect(body).toContain('#EXT-X-MEDIA-SEQUENCE:2')
  })

  // -- request log ----------------------------------------------------------

  it('records requests so tests can assert on polling behavior', async () => {
    await fetch(fx.mediaUrl)
    await fetch(fx.mediaUrl)
    expect(fx.requests.filter((r) => r.path.includes('media.m3u8'))).toHaveLength(2)
  })

  it('records the status served for each request', async () => {
    fx.setMode('manifest-404')
    await fetch(fx.mediaUrl)
    const last = fx.requests.at(-1)
    expect(last?.status).toBe(404)
  })

  // -- mode transitions -----------------------------------------------------

  it('recovers when a failure mode is cleared', async () => {
    fx.setMode('segment-403')
    expect((await fetch(fx.segmentUrl(0))).status).toBe(403)
    fx.setMode('healthy')
    expect((await fetch(fx.segmentUrl(0))).status).toBe(200)
  })

  it('releases requests held open by stall mode when the mode is cleared', async () => {
    fx.setMode('stall')
    const pending = fetch(fx.segmentUrl(0))
    await new Promise((r) => setTimeout(r, 30))
    fx.setMode('healthy')
    const res = await pending
    expect(res.status).toBe(200)
  })

  // -- lifecycle ------------------------------------------------------------

  it('reports its own mode', () => {
    expect(fx.getMode()).toBe('healthy')
    fx.setMode('slow')
    expect(fx.getMode()).toBe('slow')
  })

  it('stops serving after close()', async () => {
    const fixture = await startHlsFixture()
    const url = fixture.mediaUrl
    await fixture.close()
    await expect(fetch(url)).rejects.toThrow()
  })

  it('allocates a distinct port per fixture so tests can run concurrently', async () => {
    const a = await startHlsFixture()
    const b = await startHlsFixture()
    try {
      expect(a.port).not.toBe(b.port)
    } finally {
      await a.close()
      await b.close()
    }
  })
})
