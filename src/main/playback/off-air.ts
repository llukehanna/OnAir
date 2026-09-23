// ---------------------------------------------------------------------------
// Off-air detection
//
// A source can return HTTP 200 on the manifest and every segment while showing
// nothing: an off-air slate, an ad loop, a frozen encoder. hls.js reports no
// error, because by its measure nothing is wrong — bytes arrive on schedule.
// The stall machine never fires either, since the buffer stays fed.
//
// The tell is the live edge. A live stream's #EXT-X-MEDIA-SEQUENCE advances
// every target duration; a dead one serves the identical manifest forever.
// Fetching the playlist twice a couple of seconds apart separates them without
// looking at a single video frame.
//
// Deliberately NOT attempted here: deciding whether the stream shows the RIGHT
// game. That needs video understanding, and guessing would be worse than not
// answering. A source serving the wrong content is handled by the user
// rejecting it, which feeds source_reliability.
// ---------------------------------------------------------------------------

export type LivenessVerdict =
  /** The live edge moved. The source is producing. */
  | 'advancing'
  /** The live edge did not move. The source is up but dead. */
  | 'frozen'
  /** Could not tell — fetch failed, or the body was not a playlist. */
  | 'unknown'

export interface LivenessResult {
  verdict: LivenessVerdict
  firstSequence: number | null
  secondSequence: number | null
}

function isPlaylist(body: string): boolean {
  return body.trimStart().startsWith('#EXTM3U')
}

/** Reads #EXT-X-MEDIA-SEQUENCE. Returns null when the tag is absent. */
export function parseMediaSequence(manifest: string): number | null {
  // Anchored to line start so #EXT-X-DISCONTINUITY-SEQUENCE cannot match.
  const match = /^#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/m.exec(manifest)
  return match ? Number(match[1]) : null
}

/** Segment URIs in playlist order — the fallback signal when no sequence tag exists. */
export function parseSegmentUris(manifest: string): string[] {
  return manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Compares two fetches of the same playlist, taken a moment apart.
 *
 * A backwards sequence counts as frozen rather than advancing: a live edge that
 * rewinds is not a healthy stream, and treating it as live would keep a broken
 * source in rotation.
 */
export function compareManifests(
  first: string | null,
  second: string | null
): LivenessResult {
  if (first === null || second === null || !isPlaylist(first) || !isPlaylist(second)) {
    return { verdict: 'unknown', firstSequence: null, secondSequence: null }
  }

  // A finished asset is not a stalled live edge — it is simply not live, and
  // its playlist is supposed to be stable.
  if (first.includes('#EXT-X-ENDLIST')) {
    return { verdict: 'advancing', firstSequence: null, secondSequence: null }
  }

  const firstSequence = parseMediaSequence(first)
  const secondSequence = parseMediaSequence(second)

  if (firstSequence !== null && secondSequence !== null) {
    return {
      verdict: secondSequence > firstSequence ? 'advancing' : 'frozen',
      firstSequence,
      secondSequence,
    }
  }

  // No sequence tag: fall back to whether the segment list itself changed.
  const firstUris = parseSegmentUris(first).join('|')
  const secondUris = parseSegmentUris(second).join('|')
  return {
    verdict: firstUris === secondUris ? 'frozen' : 'advancing',
    firstSequence,
    secondSequence,
  }
}

export interface LivenessOptions {
  fetchFn?: typeof fetch
  /** Gap between the two fetches. Should exceed one target duration. */
  delayMs?: number
  /** Referer the CDN expects; many reject requests without it. */
  referer?: string | null
  origin?: string | null
}

/**
 * Fetches a media playlist twice and reports whether its live edge moved.
 *
 * Never throws: a source that cannot be checked returns 'unknown', and callers
 * treat unknown as "proceed" rather than "reject" — refusing to play something
 * because a diagnostic failed would be worse than the problem it detects.
 */
export async function checkLiveness(
  manifestUrl: string,
  options: LivenessOptions = {}
): Promise<LivenessResult> {
  const doFetch = options.fetchFn ?? fetch
  const delayMs = options.delayMs ?? 2500

  const headers: Record<string, string> = {}
  if (options.referer) headers.Referer = options.referer
  if (options.origin) headers.Origin = options.origin

  async function body(): Promise<string | null> {
    try {
      const response = await doFetch(manifestUrl, { headers })
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  const first = await body()
  if (first === null) {
    return { verdict: 'unknown', firstSequence: null, secondSequence: null }
  }

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return compareManifests(first, await body())
}
