import { verifyWebViewPlayback } from '../../src/main/playback/webview-verify'

// ---------------------------------------------------------------------------
// The embedded tier is the last rung of the ladder, so a false "it's playing"
// here means the viewer is left staring at a page that never plays while the
// app reports success and stops trying.
//
// The old heuristic — "page stopped loading in under 3s without a video
// element" — misses geo-block notices, ad-video substitution, and pages that
// never finish loading. This asks the page directly, twice, and requires the
// playback position to have actually moved.
// ---------------------------------------------------------------------------

/** Returns an evaluator that reports the given positions on successive calls. */
function evaluatorReturning(...samples: Array<{ hasVideo: boolean; currentTime: number } | Error>) {
  let call = 0
  return jest.fn(async () => {
    const sample = samples[Math.min(call++, samples.length - 1)]
    if (sample instanceof Error) throw sample
    return sample
  })
}

describe('verifyWebViewPlayback', () => {
  it('confirms playback when position advances between samples', async () => {
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 1.0 },
      { hasVideo: true, currentTime: 2.4 }
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(true)
  })

  it('rejects a page with no video element at all', async () => {
    const evaluate = evaluatorReturning({ hasVideo: false, currentTime: 0 })
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('rejects a video whose position never moves', async () => {
    // A paused or frozen player: present, but not playing.
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 3.0 },
      { hasVideo: true, currentTime: 3.0 }
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('rejects a video whose position goes backwards', async () => {
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 5.0 },
      { hasVideo: true, currentTime: 1.0 }
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('rejects when the video disappears between samples', async () => {
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 1.0 },
      { hasVideo: false, currentTime: 0 }
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('rejects rather than throwing when the page cannot be evaluated', async () => {
    const evaluate = evaluatorReturning(new Error('page destroyed'))
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('rejects when the second sample throws', async () => {
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 1.0 },
      new Error('navigated away')
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('samples exactly twice', async () => {
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 1.0 },
      { hasVideo: true, currentTime: 2.0 }
    )
    await verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('treats a sub-frame advance as not playing', async () => {
    // Floating-point noise on a paused element must not read as progress.
    const evaluate = evaluatorReturning(
      { hasVideo: true, currentTime: 2.0 },
      { hasVideo: true, currentTime: 2.0001 }
    )
    await expect(verifyWebViewPlayback({ evaluate, sampleGapMs: 0 })).resolves.toBe(false)
  })

  it('returns false when no evaluator is available', async () => {
    await expect(verifyWebViewPlayback({ evaluate: null, sampleGapMs: 0 })).resolves.toBe(false)
  })
})
