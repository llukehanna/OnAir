// ---------------------------------------------------------------------------
// Playback continuity across a source switch
//
// Sources sit at different distances behind live — 45s versus 100s is ordinary.
// Switching without reconciling that either rewinds the viewer into a play they
// already watched, or skips them past one they never saw. Neither reads as the
// seamless experience this is supposed to deliver.
//
// #EXT-X-PROGRAM-DATE-TIME tags each segment with an absolute instant. When
// both sides carry it, the correct seek target is exact: find the wall-clock
// moment being watched, then find where the replacement holds that moment.
//
// When PDT is absent — common on repackaged streams — there is no honest way to
// align, so the replacement joins at its live edge and the caller is told the
// alignment was not exact.
//
// The structural fragment shape avoids importing hls.js, keeping this pure and
// testable under Node.
// ---------------------------------------------------------------------------

export interface FragmentLike {
  /** Seconds into the level timeline where this fragment begins. */
  start: number
  /** Fragment duration in seconds. */
  duration: number
  /** Absolute wall-clock instant of the fragment's first frame, in epoch ms. */
  programDateTime?: number | null
}

export interface ContinuityInput {
  outgoingFragments: FragmentLike[]
  /** The outgoing element's currentTime. */
  outgoingPosition: number
  incomingFragments: FragmentLike[]
  /** Where the replacement would start without alignment — usually its live edge. */
  incomingDefaultPosition: number
}

export interface ContinuityResult {
  /** currentTime to set on the incoming element before it becomes visible. */
  position: number
  /** 'pdt' when both sides carried program dates; 'default' when alignment was impossible. */
  method: 'pdt' | 'default'
  /**
   * True when the replacement simply does not hold the instant being watched,
   * so the target was pinned to the nearest content it does have. A jump is
   * unavoidable in that case; this flags that it happened.
   */
  clamped: boolean
  /** The instant aligned on, when method is 'pdt'. */
  alignedToDate: number | null
}

function hasProgramDates(fragments: FragmentLike[]): boolean {
  return fragments.length > 0 && typeof fragments[0].programDateTime === 'number'
}

/** Maps a playback position to the wall-clock instant shown at that position. */
export function programDateForPosition(
  fragments: FragmentLike[],
  position: number
): number | null {
  for (const fragment of fragments) {
    if (typeof fragment.programDateTime !== 'number') continue
    if (position >= fragment.start && position < fragment.start + fragment.duration) {
      return fragment.programDateTime + (position - fragment.start) * 1000
    }
  }
  return null
}

/** Maps a wall-clock instant to the playback position holding it. */
export function positionForProgramDate(
  fragments: FragmentLike[],
  dateMs: number
): number | null {
  for (const fragment of fragments) {
    if (typeof fragment.programDateTime !== 'number') continue
    const endMs = fragment.programDateTime + fragment.duration * 1000
    if (dateMs >= fragment.programDateTime && dateMs < endMs) {
      return fragment.start + (dateMs - fragment.programDateTime) / 1000
    }
  }
  return null
}

export function computeContinuityTarget(input: ContinuityInput): ContinuityResult {
  const { outgoingFragments, outgoingPosition, incomingFragments, incomingDefaultPosition } = input

  const fallback: ContinuityResult = {
    position: Math.max(0, incomingDefaultPosition),
    method: 'default',
    clamped: false,
    alignedToDate: null,
  }

  if (!hasProgramDates(outgoingFragments) || !hasProgramDates(incomingFragments)) {
    return fallback
  }

  const watchedAt = programDateForPosition(outgoingFragments, outgoingPosition)
  if (watchedAt === null) return fallback

  const exact = positionForProgramDate(incomingFragments, watchedAt)
  if (exact !== null) {
    return {
      position: Math.max(0, exact),
      method: 'pdt',
      clamped: false,
      alignedToDate: watchedAt,
    }
  }

  // The replacement does not hold that instant. Pin to whichever end of its
  // window is nearer and report the jump rather than hiding it.
  const first = incomingFragments[0]
  const last = incomingFragments[incomingFragments.length - 1]
  const windowStart = first.programDateTime as number
  const windowEnd = (last.programDateTime as number) + last.duration * 1000

  const position =
    watchedAt < windowStart
      ? first.start // replacement is ahead of us; earliest it has
      : last.start + last.duration // replacement is behind us; newest it has

  return {
    position: Math.max(0, position),
    method: 'pdt',
    clamped: true,
    alignedToDate: watchedAt < windowStart ? windowStart : windowEnd,
  }
}
