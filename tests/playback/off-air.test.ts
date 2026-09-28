import {
  parseMediaSequence,
  parseSegmentUris,
  compareManifests,
  checkLiveness,
  resolveVariantUri,
} from '../../src/main/playback/off-air'
import { startHlsFixture, type HlsFixture } from '../../src/main/dev/hls-fixture'

// ---------------------------------------------------------------------------
// A source can return 200 on everything and still be dead: an off-air slate,
// an ad loop, a frozen encoder. hls.js reports no error because nothing is
// technically wrong — the bytes arrive, they just never change.
//
// The tell is #EXT-X-MEDIA-SEQUENCE. A live stream's sequence always advances;
// a dead one serves the same manifest forever.
// ---------------------------------------------------------------------------

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
  'media.m3u8',
  '',
].join('\n')

function manifest(sequence: number, firstSegment = sequence): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    '#EXTINF:2.000,',
    `segment${firstSegment}.ts`,
    '#EXTINF:2.000,',
    `segment${firstSegment + 1}.ts`,
    '',
  ].join('\n')
}

describe('parseMediaSequence', () => {
  it('reads the media sequence', () => {
    expect(parseMediaSequence(manifest(42))).toBe(42)
  })

  it('reads a zero sequence', () => {
    expect(parseMediaSequence(manifest(0))).toBe(0)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseMediaSequence('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE: 7 \n')).toBe(7)
  })

  it('returns null when the tag is absent', () => {
    expect(parseMediaSequence('#EXTM3U\n#EXTINF:2.0,\nseg.ts')).toBeNull()
  })

  it('returns null for an empty body', () => {
    expect(parseMediaSequence('')).toBeNull()
  })

  it('is not confused by a similar tag name', () => {
    expect(parseMediaSequence('#EXTM3U\n#EXT-X-DISCONTINUITY-SEQUENCE:9\n')).toBeNull()
  })
})

describe('parseSegmentUris', () => {
  it('extracts segment URIs in order', () => {
    expect(parseSegmentUris(manifest(3))).toEqual(['segment3.ts', 'segment4.ts'])
  })

  it('ignores tag lines and comments', () => {
    expect(parseSegmentUris('#EXTM3U\n# a comment\n#EXTINF:2,\na.ts\n')).toEqual(['a.ts'])
  })

  it('returns an empty list for a manifest with no segments', () => {
    expect(parseSegmentUris('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n')).toEqual([])
  })
})

describe('compareManifests', () => {
  it('reports advancing when the sequence moves forward', () => {
    expect(compareManifests(manifest(10), manifest(11)).verdict).toBe('advancing')
  })

  it('reports frozen when the sequence is unchanged', () => {
    expect(compareManifests(manifest(10), manifest(10)).verdict).toBe('frozen')
  })

  it('reports frozen when the sequence goes backwards', () => {
    // A rewinding sequence is not a live edge; treat it as dead rather than live.
    expect(compareManifests(manifest(11), manifest(10)).verdict).toBe('frozen')
  })

  it('falls back to segment URIs when the sequence tag is missing', () => {
    const first = '#EXTM3U\n#EXTINF:2,\na.ts\n'
    const second = '#EXTM3U\n#EXTINF:2,\nb.ts\n'
    expect(compareManifests(first, second).verdict).toBe('advancing')
  })

  it('reports frozen when neither sequence nor segments changed', () => {
    const body = '#EXTM3U\n#EXTINF:2,\na.ts\n'
    expect(compareManifests(body, body).verdict).toBe('frozen')
  })

  it('reports unknown when a body is missing', () => {
    expect(compareManifests(null, manifest(1)).verdict).toBe('unknown')
    expect(compareManifests(manifest(1), null).verdict).toBe('unknown')
  })

  it('reports unknown for a body that is not a playlist', () => {
    expect(compareManifests('<html>blocked</html>', '<html>blocked</html>').verdict).toBe('unknown')
  })

  it('surfaces the observed sequences for logging', () => {
    const result = compareManifests(manifest(4), manifest(6))
    expect(result.firstSequence).toBe(4)
    expect(result.secondSequence).toBe(6)
  })

  it('never calls a master playlist frozen — it has no live edge to read', () => {
    // Regression: the manager polled the candidate URL, which is usually a
    // master. No MEDIA-SEQUENCE, identical variant lines every time, and the
    // URI fallback read that as a frozen edge: "sequence stuck at null".
    const result = compareManifests(MASTER, MASTER)
    expect(result.verdict).toBe('unknown')
    expect(result.firstSequence).toBeNull()
    expect(result.secondSequence).toBeNull()
  })

  it('never calls a playlist with no sequence and no segments frozen', () => {
    const empty = '#EXTM3U\n#EXT-X-VERSION:3\n'
    expect(compareManifests(empty, empty).verdict).toBe('unknown')
  })

  it('treats a VOD playlist as advancing rather than dead', () => {
    // ENDLIST means a finite asset; it is not a stalled live edge.
    const vod = manifest(0) + '#EXT-X-ENDLIST\n'
    expect(compareManifests(vod, vod).verdict).toBe('advancing')
  })
})

describe('resolveVariantUri', () => {
  it('resolves the first variant against the master URL', () => {
    expect(resolveVariantUri(MASTER, 'https://cdn/live/master.m3u8?token=abc')).toBe(
      'https://cdn/live/media.m3u8'
    )
  })

  it('returns null for a media playlist', () => {
    expect(resolveVariantUri(manifest(3), 'https://cdn/x.m3u8')).toBeNull()
  })
})

describe('checkLiveness', () => {
  it('fetches twice and reports advancing for a live stream', async () => {
    let call = 0
    const fetchFn = jest.fn(async () => ({
      ok: true,
      text: async () => manifest(call++),
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/x.m3u8', { fetchFn, delayMs: 0 })
    expect(result.verdict).toBe('advancing')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('reports frozen when the same manifest is served twice', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      text: async () => manifest(5),
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/x.m3u8', { fetchFn, delayMs: 0 })
    expect(result.verdict).toBe('frozen')
  })

  it('reports unknown when the fetch fails rather than guessing', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/x.m3u8', { fetchFn, delayMs: 0 })
    expect(result.verdict).toBe('unknown')
  })

  it('reports unknown on a non-ok response', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      text: async () => '',
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/x.m3u8', { fetchFn, delayMs: 0 })
    expect(result.verdict).toBe('unknown')
  })

  it('sends the referer the CDN expects when one is supplied', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      text: async () => manifest(1),
    })) as unknown as typeof fetch

    await checkLiveness('https://cdn/x.m3u8', {
      fetchFn,
      delayMs: 0,
      referer: 'https://source.example/',
    })

    const init = (fetchFn as jest.Mock).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Referer).toBe('https://source.example/')
  })

  it('follows a master playlist to its media playlist before comparing', async () => {
    let call = 0
    const fetchFn = jest.fn(async (url: string) => ({
      ok: true,
      text: async () => (url.endsWith('master.m3u8') ? MASTER : manifest(call++)),
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/live/master.m3u8', { fetchFn, delayMs: 0 })
    expect(result).toEqual({ verdict: 'advancing', firstSequence: 0, secondSequence: 1 })

    const urls = (fetchFn as jest.Mock).mock.calls.map((c) => c[0])
    expect(urls).toEqual([
      'https://cdn/live/master.m3u8',
      'https://cdn/live/media.m3u8',
      'https://cdn/live/media.m3u8',
    ])
  })

  it('still reports frozen when the media playlist behind a master is stuck', async () => {
    const fetchFn = jest.fn(async (url: string) => ({
      ok: true,
      text: async () => (url.endsWith('master.m3u8') ? MASTER : manifest(7)),
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/live/master.m3u8', { fetchFn, delayMs: 0 })
    expect(result).toEqual({ verdict: 'frozen', firstSequence: 7, secondSequence: 7 })
  })

  it('sends the CDN headers to the variant as well', async () => {
    const fetchFn = jest.fn(async (url: string) => ({
      ok: true,
      text: async () => (url.endsWith('master.m3u8') ? MASTER : manifest(1)),
    })) as unknown as typeof fetch

    await checkLiveness('https://cdn/live/master.m3u8', {
      fetchFn,
      delayMs: 0,
      referer: 'https://source.example/',
    })

    for (const [, init] of (fetchFn as jest.Mock).mock.calls) {
      expect((init.headers as Record<string, string>).Referer).toBe('https://source.example/')
    }
  })

  it('reports unknown when the variant cannot be fetched', async () => {
    const fetchFn = jest.fn(async (url: string) => ({
      ok: url.endsWith('master.m3u8'),
      text: async () => MASTER,
    })) as unknown as typeof fetch

    const result = await checkLiveness('https://cdn/live/master.m3u8', { fetchFn, delayMs: 0 })
    expect(result.verdict).toBe('unknown')
  })
})

// The dev fixture hands the manager its master URL, exactly as real sources
// do. This is the path that produced the spurious off_air failovers.
describe('checkLiveness against the HLS fixture master URL', () => {
  let fx: HlsFixture

  beforeEach(async () => {
    fx = await startHlsFixture({ windowSize: 6 })
  })

  afterEach(async () => {
    await fx.close()
  })

  /** Advances the fixture between the two polls, standing in for the delay. */
  function advancingFetch(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init)
      if (String(input).endsWith('media.m3u8')) fx.advance()
      return response
    }) as typeof fetch
  }

  it('reports advancing for a healthy stream', async () => {
    const result = await checkLiveness(fx.masterUrl, { fetchFn: advancingFetch(), delayMs: 0 })
    expect(result.verdict).toBe('advancing')
    expect(result.firstSequence).not.toBeNull()
  })

  it('reports frozen with a real sequence number in off-air mode', async () => {
    fx.advance(3)
    fx.setMode('off-air')
    const result = await checkLiveness(fx.masterUrl, { fetchFn: advancingFetch(), delayMs: 0 })
    expect(result).toEqual({ verdict: 'frozen', firstSequence: 3, secondSequence: 3 })
  })
})
