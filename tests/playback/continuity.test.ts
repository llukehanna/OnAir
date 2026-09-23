import {
  programDateForPosition,
  positionForProgramDate,
  computeContinuityTarget,
  type FragmentLike,
} from '../../src/renderer/src/playback/continuity'

// ---------------------------------------------------------------------------
// Sources sit at different distances behind live — 45s versus 100s is ordinary.
// Switching naively either rewinds the viewer into a play they already watched
// or skips them past one they never saw.
//
// #EXT-X-PROGRAM-DATE-TIME gives an absolute instant per segment, so when both
// sides carry it the correct target is exact rather than estimated. When it is
// absent — common on repackaged streams — the honest answer is the live edge.
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-08-14T00:00:00.000Z')

/** Builds a fragment list of `count` 2s segments starting at wall-clock `startMs`. */
function frags(count: number, startMs: number | null, startOffset = 0): FragmentLike[] {
  return Array.from({ length: count }, (_, i) => ({
    start: startOffset + i * 2,
    duration: 2,
    programDateTime: startMs === null ? null : startMs + i * 2000,
  }))
}

describe('programDateForPosition', () => {
  it('maps a playback position to its wall-clock instant', () => {
    expect(programDateForPosition(frags(5, T0), 0)).toBe(T0)
  })

  it('interpolates within a segment', () => {
    expect(programDateForPosition(frags(5, T0), 3)).toBe(T0 + 3000)
  })

  it('handles a position inside a later segment', () => {
    expect(programDateForPosition(frags(5, T0), 7.5)).toBe(T0 + 7500)
  })

  it('returns null when fragments carry no program date', () => {
    expect(programDateForPosition(frags(5, null), 3)).toBeNull()
  })

  it('returns null for a position beyond the last segment', () => {
    expect(programDateForPosition(frags(3, T0), 99)).toBeNull()
  })

  it('returns null for an empty fragment list', () => {
    expect(programDateForPosition([], 1)).toBeNull()
  })
})

describe('positionForProgramDate', () => {
  it('maps a wall-clock instant to a playback position', () => {
    expect(positionForProgramDate(frags(5, T0), T0)).toBe(0)
  })

  it('interpolates within a segment', () => {
    expect(positionForProgramDate(frags(5, T0), T0 + 3000)).toBe(3)
  })

  it('respects a non-zero timeline offset', () => {
    expect(positionForProgramDate(frags(5, T0, 100), T0 + 3000)).toBe(103)
  })

  it('returns null for an instant the stream does not cover', () => {
    expect(positionForProgramDate(frags(3, T0), T0 + 60_000)).toBeNull()
  })

  it('returns null when fragments carry no program date', () => {
    expect(positionForProgramDate(frags(5, null), T0)).toBeNull()
  })

  it('round-trips with programDateForPosition', () => {
    const f = frags(6, T0)
    const date = programDateForPosition(f, 5)
    expect(date).not.toBeNull()
    expect(positionForProgramDate(f, date as number)).toBeCloseTo(5)
  })
})

describe('computeContinuityTarget', () => {
  // -- the exact case -------------------------------------------------------

  it('lands the viewer on the same instant when both sides carry PDT', () => {
    // Incoming is 10s further behind live: its timeline starts 10s earlier.
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 8,
      incomingFragments: frags(10, T0 - 10_000),
      incomingDefaultPosition: 18,
    })
    expect(result.method).toBe('pdt')
    expect(result.clamped).toBe(false)
    // The instant being watched is T0+8s, which the incoming stream holds at 18s.
    expect(result.position).toBeCloseTo(18)
  })

  it('reports the instant it aligned on', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 4,
      incomingFragments: frags(10, T0),
      incomingDefaultPosition: 0,
    })
    expect(result.alignedToDate).toBe(T0 + 4000)
  })

  // -- no PDT ---------------------------------------------------------------

  it('falls back to the live edge when the incoming stream has no PDT', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 8,
      incomingFragments: frags(10, null),
      incomingDefaultPosition: 16,
    })
    expect(result.method).toBe('default')
    expect(result.position).toBe(16)
  })

  it('falls back when the outgoing stream has no PDT', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, null),
      outgoingPosition: 8,
      incomingFragments: frags(10, T0),
      incomingDefaultPosition: 16,
    })
    expect(result.method).toBe('default')
  })

  it('falls back when there is no outgoing stream at all', () => {
    const result = computeContinuityTarget({
      outgoingFragments: [],
      outgoingPosition: 0,
      incomingFragments: frags(10, T0),
      incomingDefaultPosition: 16,
    })
    expect(result.method).toBe('default')
    expect(result.position).toBe(16)
  })

  // -- clamping -------------------------------------------------------------

  it('clamps to the live edge when the incoming stream has not reached that instant', () => {
    // Incoming is far behind: its newest content predates what we were watching.
    const incoming = frags(5, T0 - 60_000)
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 8,
      incomingFragments: incoming,
      incomingDefaultPosition: 8,
    })
    expect(result.clamped).toBe(true)
    // Cannot do better than its newest available content.
    expect(result.position).toBeCloseTo(10)
  })

  it('clamps to the earliest available content when the incoming stream is ahead', () => {
    // Incoming is ahead of us: it no longer holds the instant we were watching.
    const incoming = frags(5, T0 + 60_000)
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 2,
      incomingFragments: incoming,
      incomingDefaultPosition: 8,
    })
    expect(result.clamped).toBe(true)
    expect(result.position).toBe(0)
  })

  it('marks a clamped result as clamped even though it still uses PDT', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 8,
      incomingFragments: frags(5, T0 - 60_000),
      incomingDefaultPosition: 8,
    })
    expect(result.method).toBe('pdt')
    expect(result.clamped).toBe(true)
  })

  // -- sanity ---------------------------------------------------------------

  it('never returns a negative position', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 0,
      incomingFragments: frags(5, T0 + 60_000),
      incomingDefaultPosition: 0,
    })
    expect(result.position).toBeGreaterThanOrEqual(0)
  })

  it('handles both streams being perfectly aligned', () => {
    const result = computeContinuityTarget({
      outgoingFragments: frags(10, T0),
      outgoingPosition: 6,
      incomingFragments: frags(10, T0),
      incomingDefaultPosition: 18,
    })
    expect(result.position).toBeCloseTo(6)
    expect(result.clamped).toBe(false)
  })
})
