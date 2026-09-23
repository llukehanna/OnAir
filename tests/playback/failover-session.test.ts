import {
  createFailoverSession,
  type FailoverSession,
} from '../../src/main/playback/failover-session'
import type { StreamCandidate } from '../../src/main/types'

// ---------------------------------------------------------------------------
// The session owns three things that must not be re-derived elsewhere:
// which candidates have been tried, whether a switch is already running, and
// how far up the escalation ladder we are.
//
// The in-flight lock is load-bearing. Renderer stall signals and main-side
// off-air checks can both request a switch at the same instant, and two
// concurrent switches would race to own the staging element.
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    candidateId: 'c1',
    gameId: 'nfl_1',
    sourceId: 's1',
    streamUrl: 'https://cdn.example/1.m3u8',
    streamType: 'hls',
    quality: '1080p',
    score: 0.9,
    probedAt: 0,
    probeSuccess: true,
    probeLatencyMs: 100,
    refererUrl: null,
    cdnOrigin: null,
    cdnReferer: null,
    ...overrides,
  }
}

const THREE = [
  candidate({ candidateId: 'a', sourceId: 'sa', score: 0.9 }),
  candidate({ candidateId: 'b', sourceId: 'sb', score: 0.7 }),
  candidate({ candidateId: 'c', sourceId: 'sc', score: 0.5 }),
]

describe('failover session', () => {
  let s: FailoverSession

  beforeEach(() => {
    s = createFailoverSession('nfl_1', THREE)
  })

  // -- identity and initial state -------------------------------------------

  it('exposes the game it belongs to', () => {
    expect(s.gameId).toBe('nfl_1')
  })

  it('starts on the candidates rung', () => {
    expect(s.rung).toBe('candidates')
  })

  it('starts with no switch in flight', () => {
    expect(s.isSwitching).toBe(false)
  })

  // -- candidate progression ------------------------------------------------

  it('offers the highest-scoring candidate first', () => {
    expect(s.nextCandidate()?.candidateId).toBe('a')
  })

  it('orders by score regardless of input order', () => {
    const shuffled = createFailoverSession('g', [
      candidate({ candidateId: 'low', score: 0.1 }),
      candidate({ candidateId: 'high', score: 0.99 }),
    ])
    expect(shuffled.nextCandidate()?.candidateId).toBe('high')
  })

  it('does not consume a candidate merely by looking at it', () => {
    expect(s.nextCandidate()?.candidateId).toBe('a')
    expect(s.nextCandidate()?.candidateId).toBe('a')
  })

  it('skips a candidate once attempted', () => {
    s.markAttempted('a')
    expect(s.nextCandidate()?.candidateId).toBe('b')
  })

  it('walks the full list in score order', () => {
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const next = s.nextCandidate()
      if (!next) break
      seen.push(next.candidateId)
      s.markAttempted(next.candidateId)
    }
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('returns null once every candidate has been attempted', () => {
    for (const c of THREE) s.markAttempted(c.candidateId)
    expect(s.nextCandidate()).toBeNull()
  })

  it('reports how many candidates remain', () => {
    expect(s.remainingCount).toBe(3)
    s.markAttempted('a')
    expect(s.remainingCount).toBe(2)
  })

  it('ignores markAttempted for an unknown candidate', () => {
    s.markAttempted('nope')
    expect(s.remainingCount).toBe(3)
  })

  it('is idempotent when the same candidate is marked twice', () => {
    s.markAttempted('a')
    s.markAttempted('a')
    expect(s.remainingCount).toBe(2)
  })

  it('handles being constructed with no candidates', () => {
    const empty = createFailoverSession('g', [])
    expect(empty.nextCandidate()).toBeNull()
    expect(empty.remainingCount).toBe(0)
  })

  // -- in-flight lock -------------------------------------------------------

  it('grants the switch lock to the first caller', () => {
    expect(s.beginSwitch()).toBe(true)
    expect(s.isSwitching).toBe(true)
  })

  it('denies the lock while a switch is already running', () => {
    s.beginSwitch()
    expect(s.beginSwitch()).toBe(false)
  })

  it('collapses a burst of concurrent requests into one switch', () => {
    const granted = [s.beginSwitch(), s.beginSwitch(), s.beginSwitch(), s.beginSwitch()]
    expect(granted.filter(Boolean)).toHaveLength(1)
  })

  it('releases the lock on endSwitch', () => {
    s.beginSwitch()
    s.endSwitch()
    expect(s.isSwitching).toBe(false)
    expect(s.beginSwitch()).toBe(true)
  })

  it('tolerates endSwitch without a matching beginSwitch', () => {
    expect(() => s.endSwitch()).not.toThrow()
    expect(s.isSwitching).toBe(false)
  })

  // -- escalation ladder ----------------------------------------------------

  it('escalates candidates -> reextract -> webview -> exhausted', () => {
    expect(s.rung).toBe('candidates')
    s.escalate()
    expect(s.rung).toBe('reextract')
    s.escalate()
    expect(s.rung).toBe('webview')
    s.escalate()
    expect(s.rung).toBe('exhausted')
  })

  it('stays exhausted once exhausted', () => {
    s.escalate()
    s.escalate()
    s.escalate()
    s.escalate()
    expect(s.rung).toBe('exhausted')
  })

  it('reports terminal state only when exhausted', () => {
    expect(s.isExhausted).toBe(false)
    s.escalate()
    s.escalate()
    expect(s.isExhausted).toBe(false)
    s.escalate()
    expect(s.isExhausted).toBe(true)
  })

  it('allows the re-extraction rung exactly once', () => {
    expect(s.canReextract).toBe(true)
    s.escalate()
    expect(s.rung).toBe('reextract')
    s.replaceCandidates([candidate({ candidateId: 'fresh' })])
    expect(s.canReextract).toBe(false)
  })

  // -- re-extraction refresh ------------------------------------------------

  it('replaceCandidates clears the attempted set so fresh URLs are tried', () => {
    for (const c of THREE) s.markAttempted(c.candidateId)
    expect(s.nextCandidate()).toBeNull()
    s.replaceCandidates([candidate({ candidateId: 'fresh', score: 0.8 })])
    expect(s.nextCandidate()?.candidateId).toBe('fresh')
  })

  it('replaceCandidates returns to the candidates rung', () => {
    s.escalate()
    s.replaceCandidates([candidate({ candidateId: 'fresh' })])
    expect(s.rung).toBe('candidates')
  })

  it('replaceCandidates with an empty list leaves nothing to try', () => {
    s.escalate()
    s.replaceCandidates([])
    expect(s.nextCandidate()).toBeNull()
  })

  it('does not grant a second re-extraction after one has been used', () => {
    s.escalate()
    s.replaceCandidates([candidate({ candidateId: 'fresh' })])
    s.markAttempted('fresh')
    expect(s.nextCandidate()).toBeNull()
    expect(s.canReextract).toBe(false)
  })

  // -- user pin -------------------------------------------------------------

  it('records a user pin', () => {
    s.pin('b')
    expect(s.pinnedCandidateId).toBe('b')
  })

  it('clears the pin when the pinned candidate is attempted and fails', () => {
    s.pin('b')
    s.markAttempted('b')
    expect(s.pinnedCandidateId).toBeNull()
  })

  it('leaves the pin intact when a different candidate fails', () => {
    s.pin('b')
    s.markAttempted('a')
    expect(s.pinnedCandidateId).toBe('b')
  })

  it('offers the pinned candidate ahead of a higher-scoring one', () => {
    s.pin('c')
    expect(s.nextCandidate()?.candidateId).toBe('c')
  })

  it('falls back to score order once the pin is gone', () => {
    s.pin('c')
    s.markAttempted('c')
    expect(s.nextCandidate()?.candidateId).toBe('a')
  })

  it('ignores a pin for an unknown candidate', () => {
    s.pin('nope')
    expect(s.pinnedCandidateId).toBeNull()
    expect(s.nextCandidate()?.candidateId).toBe('a')
  })

  // -- webview tier ---------------------------------------------------------

  it('exposes an embed URL for the webview rung when a candidate carries one', () => {
    const withEmbed = createFailoverSession('g', [
      candidate({ candidateId: 'x', embedPlayerUrl: 'https://embed.example/e/1' }),
    ])
    expect(withEmbed.embedPlayerUrls()).toEqual(['https://embed.example/e/1'])
  })

  it('returns no embed URLs when no candidate carries one', () => {
    expect(s.embedPlayerUrls()).toEqual([])
  })

  it('deduplicates embed URLs', () => {
    const dupes = createFailoverSession('g', [
      candidate({ candidateId: 'x', embedPlayerUrl: 'https://embed.example/e/1' }),
      candidate({ candidateId: 'y', embedPlayerUrl: 'https://embed.example/e/1' }),
    ])
    expect(dupes.embedPlayerUrls()).toHaveLength(1)
  })
})
