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
// Candidate URLs are usually master playlists, which carry no live edge at all
// — only variant URIs that never change. The check follows a master to its
// first variant and polls that. A playlist whose edge cannot be read is
// 'unknown', never 'frozen': unknown is not evidence of a dead stream.
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

/** A master (multivariant) playlist lists variants, not media segments. */
function isMasterPlaylist(body: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(body)
}

/**
 * The first variant of a master playlist, resolved against the master's URL.
 * Returns null when the body is not a master or names no variant.
 */
export function resolveVariantUri(manifest: string, manifestUrl: string): string | null {
  if (!isMasterPlaylist(manifest)) return null
  const lines = manifest.split(/\r?\n/).map((line) => line.trim())
  const tagIndex = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF:'))
  const uri = lines.slice(tagIndex + 1).find((line) => line.length > 0 && !line.startsWith('#'))
  if (!uri) return null
  try {
    return new URL(uri, manifestUrl).toString()
  } catch {
    return null
  }
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

  // A master playlist has no live edge. Its variant lines are identical on
  // every fetch, so the URI fallback below would call any master frozen.
  if (isMasterPlaylist(first) || isMasterPlaylist(second)) {
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
  // With no segments either, there is nothing to compare.
  const firstSegments = parseSegmentUris(first)
  const secondSegments = parseSegmentUris(second)
  if (firstSegments.length === 0 || secondSegments.length === 0) {
    return { verdict: 'unknown', firstSequence, secondSequence }
  }
  const firstUris = firstSegments.join('|')
  const secondUris = secondSegments.join('|')
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
 * Given a master playlist, polls its first variant instead.
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

  async function body(url: string): Promise<string | null> {
    try {
      const response = await doFetch(url, { headers })
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  const unknown: LivenessResult = { verdict: 'unknown', firstSequence: null, secondSequence: null }

  let playlistUrl = manifestUrl
  let first = await body(playlistUrl)
  if (first === null) return unknown

  const variantUrl = resolveVariantUri(first, manifestUrl)
  if (variantUrl !== null) {
    playlistUrl = variantUrl
    first = await body(playlistUrl)
    if (first === null) return unknown
  }

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return compareManifests(first, await body(playlistUrl))
}
