import {
  parseMediaSequence,
  parseSegmentUris,
  compareManifests,
  checkLiveness,
} from '../../src/main/playback/off-air'

// ---------------------------------------------------------------------------
// A source can return 200 on everything and still be dead: an off-air slate,
// an ad loop, a frozen encoder. hls.js reports no error because nothing is
// technically wrong — the bytes arrive, they just never change.
//
// The tell is #EXT-X-MEDIA-SEQUENCE. A live stream's sequence always advances;
// a dead one serves the same manifest forever.
// ---------------------------------------------------------------------------

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

  it('treats a VOD playlist as advancing rather than dead', () => {
    // ENDLIST means a finite asset; it is not a stalled live edge.
    const vod = manifest(0) + '#EXT-X-ENDLIST\n'
    expect(compareManifests(vod, vod).verdict).toBe('advancing')
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
})
