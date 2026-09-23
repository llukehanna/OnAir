import { getActiveView } from './webview'

// ---------------------------------------------------------------------------
// Embedded playback verification
//
// The WebContentsView tier is the last rung of the ladder. A false positive
// here is the worst outcome in the whole system: the app declares success,
// stops escalating, and leaves the viewer on a page that never plays.
//
// The previous signal was "the page stopped loading in under 3 seconds without
// a video element", which misses every interesting failure — a geo-block
// notice, an ad video substituted for the game, and pages that never finish
// loading at all because their ad frames keep the network busy forever.
//
// This asks the page directly, twice, and requires the playback position to
// have actually moved. A video element that exists but sits at the same
// timestamp is not playing.
// ---------------------------------------------------------------------------

export interface PlaybackProbe {
  hasVideo: boolean
  currentTime: number
}

export type PageEvaluator = (() => Promise<PlaybackProbe>) | null

export interface VerifyOptions {
  /** Injected for tests; defaults to probing the active WebContentsView. */
  evaluate?: PageEvaluator
  /** Gap between the two samples. Must exceed a frame to be meaningful. */
  sampleGapMs?: number
}

/**
 * Minimum position change that counts as progress.
 *
 * Floating-point noise on a paused element can produce a tiny nonzero delta,
 * so anything under a frame at 30fps is treated as stationary.
 */
const MIN_PROGRESS_SECONDS = 0.03

/**
 * Finds the furthest-along video on the page, including same-origin iframes —
 * embed pages routinely nest the real player one or two frames deep.
 */
const PROBE_SCRIPT = `
(() => {
  let hasVideo = false
  let currentTime = 0
  const consider = (doc) => {
    if (!doc) return
    doc.querySelectorAll('video').forEach((v) => {
      hasVideo = true
      if (v.currentTime > currentTime) currentTime = v.currentTime
    })
    doc.querySelectorAll('iframe').forEach((f) => {
      try { consider(f.contentDocument) } catch (e) { /* cross-origin */ }
    })
  }
  consider(document)
  return { hasVideo, currentTime }
})()
`

function defaultEvaluator(): PageEvaluator {
  const view = getActiveView()
  if (!view) return null
  return () => view.webContents.executeJavaScript(PROBE_SCRIPT) as Promise<PlaybackProbe>
}

/**
 * Returns true only when the embedded page is demonstrably playing.
 *
 * Never throws — an unverifiable page is reported as not playing, because the
 * caller's next move on false is to keep escalating, which is the safe
 * direction when the last rung is in doubt.
 */
export async function verifyWebViewPlayback(options: VerifyOptions = {}): Promise<boolean> {
  const evaluate = options.evaluate === undefined ? defaultEvaluator() : options.evaluate
  if (!evaluate) return false

  const sampleGapMs = options.sampleGapMs ?? 1500

  let first: PlaybackProbe
  try {
    first = await evaluate()
  } catch {
    return false
  }
  if (!first.hasVideo) return false

  if (sampleGapMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, sampleGapMs))
  }

  let second: PlaybackProbe
  try {
    second = await evaluate()
  } catch {
    return false
  }
  if (!second.hasVideo) return false

  return second.currentTime - first.currentTime >= MIN_PROGRESS_SECONDS
}
