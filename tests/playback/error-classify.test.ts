import { classifyHlsError, extractHttpStatus, type HlsErrorLike } from '../../src/renderer/src/playback/error-classify'

// ---------------------------------------------------------------------------
// Fatal hls.js errors are not equivalent, and the old code treated them as if
// they were: retry manifestLoadError twice, otherwise give up. The costly
// mistake is treating an expired CDN token as a dead source — the source is
// fine, only the URL went stale.
// ---------------------------------------------------------------------------

function err(overrides: Partial<HlsErrorLike> = {}): HlsErrorLike {
  return { type: 'networkError', details: 'fragLoadError', fatal: true, ...overrides }
}

describe('extractHttpStatus', () => {
  it('reads response.code', () => {
    expect(extractHttpStatus(err({ response: { code: 403 } }))).toBe(403)
  })

  it('reads networkDetails.status', () => {
    expect(extractHttpStatus(err({ networkDetails: { status: 404 } }))).toBe(404)
  })

  it('reads context.responseStatus', () => {
    expect(extractHttpStatus(err({ context: { responseStatus: 410 } }))).toBe(410)
  })

  it('returns null when no status is present anywhere', () => {
    expect(extractHttpStatus(err())).toBeNull()
  })

  it('prefers response.code over the other carriers', () => {
    expect(
      extractHttpStatus(err({ response: { code: 403 }, networkDetails: { status: 500 } }))
    ).toBe(403)
  })

  it('ignores a zero status, which hls.js uses for aborted requests', () => {
    expect(extractHttpStatus(err({ response: { code: 0 } }))).toBeNull()
  })
})

describe('classifyHlsError', () => {
  // -- non-fatal ----------------------------------------------------------

  it('ignores a non-fatal error', () => {
    const result = classifyHlsError(err({ fatal: false }), { hasPlayedSuccessfully: true })
    expect(result.action).toBe('ignore')
  })

  it('ignores a non-fatal error even with a failing status', () => {
    const result = classifyHlsError(
      err({ fatal: false, response: { code: 403 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('ignore')
  })

  // -- token expiry: the case that matters -------------------------------

  it('treats a 403 on a segment after successful playback as an expired token', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadError', response: { code: 403 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('reextract')
    expect(result.reason).toBe('token_expired')
  })

  it('treats a 410 on a segment after successful playback as an expired token', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadError', response: { code: 410 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('reextract')
  })

  it('does NOT call it token expiry when the stream never played', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadError', response: { code: 403 } }),
      { hasPlayedSuccessfully: false }
    )
    expect(result.action).toBe('failover')
    expect(result.reason).toBe('forbidden')
  })

  it('reports the status it classified on', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadError', response: { code: 403 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.httpStatus).toBe(403)
  })

  // -- source gone -------------------------------------------------------

  it('treats a 404 on the manifest as a source that is gone', () => {
    const result = classifyHlsError(
      err({ details: 'manifestLoadError', response: { code: 404 } }),
      { hasPlayedSuccessfully: false }
    )
    expect(result.action).toBe('failover-degrade')
    expect(result.reason).toBe('source_gone')
  })

  it('treats a 404 on a level playlist as a source that is gone', () => {
    const result = classifyHlsError(
      err({ details: 'levelLoadError', response: { code: 404 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('failover-degrade')
    expect(result.reason).toBe('source_gone')
  })

  it('does not treat a 404 on a single segment as the source being gone', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadError', response: { code: 404 } }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).not.toBe('failover-degrade')
  })

  // -- timeouts ----------------------------------------------------------

  it('classifies a manifest timeout as a plain failover', () => {
    const result = classifyHlsError(
      err({ details: 'manifestLoadTimeOut' }),
      { hasPlayedSuccessfully: false }
    )
    expect(result.action).toBe('failover')
    expect(result.reason).toBe('timeout')
  })

  it('classifies a fragment timeout as a plain failover', () => {
    const result = classifyHlsError(
      err({ details: 'fragLoadTimeOut' }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.reason).toBe('timeout')
  })

  // -- media errors ------------------------------------------------------

  it('marks a media error as degrading, since the stream itself is unusable', () => {
    const result = classifyHlsError(
      err({ type: 'mediaError', details: 'fragParsingError' }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('failover-degrade')
    expect(result.reason).toBe('media_error')
  })

  it('marks a mux error as degrading', () => {
    const result = classifyHlsError(
      err({ type: 'muxError', details: 'remuxAllocError' }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('failover-degrade')
  })

  // -- fallback ----------------------------------------------------------

  it('falls back to a plain failover for an unrecognized fatal error', () => {
    const result = classifyHlsError(
      err({ type: 'otherError', details: 'internalException' }),
      { hasPlayedSuccessfully: true }
    )
    expect(result.action).toBe('failover')
    expect(result.reason).toBe('fatal_error')
  })

  it('never returns reextract for a manifest failure, only for segments', () => {
    for (const details of ['manifestLoadError', 'levelLoadError', 'manifestParsingError']) {
      const result = classifyHlsError(
        err({ details, response: { code: 403 } }),
        { hasPlayedSuccessfully: true }
      )
      expect(result.action).not.toBe('reextract')
    }
  })

  it('always produces a reason suitable for the events table', () => {
    const cases: HlsErrorLike[] = [
      err({ details: 'fragLoadError', response: { code: 403 } }),
      err({ details: 'manifestLoadError', response: { code: 404 } }),
      err({ details: 'fragLoadTimeOut' }),
      err({ type: 'mediaError', details: 'bufferAppendError' }),
      err({ type: 'otherError', details: 'internalException' }),
    ]
    for (const c of cases) {
      const result = classifyHlsError(c, { hasPlayedSuccessfully: true })
      expect(result.reason).toMatch(/^[a-z_]+$/)
    }
  })
})
