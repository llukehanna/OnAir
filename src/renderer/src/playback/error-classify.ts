// ---------------------------------------------------------------------------
// Fatal error classification
//
// Fatal hls.js errors demand different responses, and collapsing them loses the
// most valuable distinction in the whole playback path:
//
//   a 403 on a segment AFTER the stream was playing is an expired CDN token,
//   not a dead source.
//
// These CDNs bind tokens to the browser session that captured them (see
// src/main/playback/proxy.ts), so tokens go stale on a working source. Treating
// that as a failure discards a source that is still good and burns a slot on
// the candidate list for no reason.
//
// The shape below is structural on purpose — it does not import hls.js, so this
// module stays pure and testable under Node with plain objects.
// ---------------------------------------------------------------------------

export interface HlsErrorLike {
  /** hls.js ErrorTypes value, e.g. 'networkError' | 'mediaError' | 'muxError' | 'otherError'. */
  type: string
  /** hls.js ErrorDetails value, e.g. 'fragLoadError' | 'manifestLoadError'. */
  details: string
  fatal: boolean
  response?: { code?: number } | null
  networkDetails?: { status?: number } | null
  context?: { responseStatus?: number } | null
}

export type FailureAction =
  /** Refresh this source's URL and stay on it — the source is fine, the URL is stale. */
  | 'reextract'
  /** Move to the next candidate. */
  | 'failover'
  /** Move on and mark the source degraded so scoring demotes it. */
  | 'failover-degrade'
  /** Non-fatal; hls.js recovers on its own. */
  | 'ignore'

export interface ClassifiedFailure {
  action: FailureAction
  /** Machine-readable, safe to store in the events table. */
  reason: string
  httpStatus: number | null
}

/** Details values that concern a media segment rather than a playlist. */
const SEGMENT_DETAILS = new Set([
  'fragLoadError',
  'fragLoadTimeOut',
  'fragParsingError',
  'fragDecryptError',
])

/** Details values that concern a playlist — the source's index, not one segment. */
const PLAYLIST_DETAILS = new Set([
  'manifestLoadError',
  'manifestLoadTimeOut',
  'manifestParsingError',
  'levelLoadError',
  'levelLoadTimeOut',
  'levelEmptyError',
  'audioTrackLoadError',
  'audioTrackLoadTimeOut',
])

/** Statuses that mean "this specific URL is no longer authorized or present". */
const GONE_STATUSES = new Set([403, 410])

/**
 * Pulls the HTTP status out of whichever field hls.js populated. Different
 * loaders and error paths carry it in different places, so all three are
 * checked. A zero status means the request was aborted, not answered.
 */
export function extractHttpStatus(error: HlsErrorLike): number | null {
  const candidates = [
    error.response?.code,
    error.networkDetails?.status,
    error.context?.responseStatus,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && value > 0) return value
  }
  return null
}

function isTimeout(details: string): boolean {
  return details.toLowerCase().includes('timeout')
}

export function classifyHlsError(
  error: HlsErrorLike,
  context: { hasPlayedSuccessfully: boolean }
): ClassifiedFailure {
  const httpStatus = extractHttpStatus(error)

  // hls.js recovers from non-fatal errors internally. Acting on them would
  // failover away from a stream that was about to be fine.
  if (!error.fatal) {
    return { action: 'ignore', reason: 'non_fatal', httpStatus }
  }

  const isSegment = SEGMENT_DETAILS.has(error.details)
  const isPlaylist = PLAYLIST_DETAILS.has(error.details)

  // Expired token: only meaningful on a segment, and only once the stream has
  // actually played. A 403 on the first segment means we were never authorized,
  // which is a different problem and not worth a re-extraction.
  if (isSegment && httpStatus !== null && GONE_STATUSES.has(httpStatus)) {
    return context.hasPlayedSuccessfully
      ? { action: 'reextract', reason: 'token_expired', httpStatus }
      : { action: 'failover', reason: 'forbidden', httpStatus }
  }

  // A playlist that 404s or 410s means the source no longer publishes this
  // stream at all. Demote it so scoring stops preferring it.
  if (isPlaylist && httpStatus !== null && (httpStatus === 404 || GONE_STATUSES.has(httpStatus))) {
    return { action: 'failover-degrade', reason: 'source_gone', httpStatus }
  }

  if (isTimeout(error.details)) {
    return { action: 'failover', reason: 'timeout', httpStatus }
  }

  // The stream is reaching us but cannot be decoded or remuxed. The source is
  // serving something unusable, which is a property of the source.
  if (error.type === 'mediaError' || error.type === 'muxError') {
    return { action: 'failover-degrade', reason: 'media_error', httpStatus }
  }

  return { action: 'failover', reason: 'fatal_error', httpStatus }
}
