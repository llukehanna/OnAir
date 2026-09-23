import type { StreamCandidate } from '../types'

// ---------------------------------------------------------------------------
// Failover session
//
// Per-game state for the escalation ladder. Owns three things so that no
// caller has to re-derive them:
//
//   1. which candidates have been tried
//   2. whether a switch is already running
//   3. how far up the ladder we are
//
// The in-flight lock is the load-bearing part. A renderer stall timeout and a
// main-side off-air check can both request a switch in the same instant, and
// two concurrent switches would race to own the staging video element. The
// renderer's stall machine already collapses repeated stall events, but it
// cannot see requests originating in main — so the lock lives here too.
//
// The ladder:
//
//   candidates --exhausted--> reextract --nothing playable--> webview --> exhausted
//
// Re-extraction is allowed exactly once per session. Cached URLs may all be
// expired tokens rather than dead sources, so one fresh pass is worth the wait;
// a second would just be a retry loop holding a frozen frame.
// ---------------------------------------------------------------------------

export type EscalationRung = 'candidates' | 'reextract' | 'webview' | 'exhausted'

const LADDER: EscalationRung[] = ['candidates', 'reextract', 'webview', 'exhausted']

export interface FailoverSession {
  readonly gameId: string
  readonly rung: EscalationRung
  readonly isExhausted: boolean
  readonly isSwitching: boolean
  readonly remainingCount: number
  /** Set only while a user-selected candidate has not yet failed. */
  readonly pinnedCandidateId: string | null

  /**
   * The candidate that should be tried next, without consuming it. A user pin
   * outranks score; otherwise highest score wins. Null when nothing is left.
   */
  nextCandidate(): StreamCandidate | null
  /** Record an attempt. Clears the pin if the pinned candidate was the one that failed. */
  markAttempted(candidateId: string): void
  /** True while the one permitted re-extraction is still available. */
  readonly canReextract: boolean
  /** Install fresh candidates after re-extraction; clears attempts, returns to 'candidates'. */
  replaceCandidates(candidates: StreamCandidate[]): void
  /** Record a user's manual selection. Ignored for an unknown candidate. */
  pin(candidateId: string): void
  /** Acquire the switch lock. False when a switch is already in flight. */
  beginSwitch(): boolean
  /** Release the switch lock. Safe to call unpaired. */
  endSwitch(): void
  /** Move one rung up the ladder. Saturates at 'exhausted'. */
  escalate(): void
  /** Distinct embed URLs carried by candidates, for the WebContentsView rung. */
  embedPlayerUrls(): string[]
}

export function createFailoverSession(
  gameId: string,
  candidates: StreamCandidate[]
): FailoverSession {
  // Sorted on entry so nextCandidate() stays a cheap scan and callers cannot
  // depend on incoming order.
  let ranked = [...candidates].sort((a, b) => b.score - a.score)
  const attempted = new Set<string>()
  let rungIndex = 0
  let switching = false
  let pinned: string | null = null
  let reextractUsed = false

  function knows(candidateId: string): boolean {
    return ranked.some((c) => c.candidateId === candidateId)
  }

  return {
    gameId,

    get rung() {
      return LADDER[rungIndex]
    },

    get isExhausted() {
      return LADDER[rungIndex] === 'exhausted'
    },

    get isSwitching() {
      return switching
    },

    get remainingCount() {
      return ranked.filter((c) => !attempted.has(c.candidateId)).length
    },

    get pinnedCandidateId() {
      return pinned
    },

    get canReextract() {
      return !reextractUsed
    },

    nextCandidate() {
      if (pinned !== null && !attempted.has(pinned)) {
        const pick = ranked.find((c) => c.candidateId === pinned)
        if (pick) return pick
      }
      return ranked.find((c) => !attempted.has(c.candidateId)) ?? null
    },

    markAttempted(candidateId: string) {
      if (!knows(candidateId)) return
      attempted.add(candidateId)
      // A manual pick that dies does not hold the player hostage — staying on
      // air outranks honoring the choice.
      if (pinned === candidateId) pinned = null
    },

    replaceCandidates(next: StreamCandidate[]) {
      reextractUsed = true
      ranked = [...next].sort((a, b) => b.score - a.score)
      attempted.clear()
      pinned = null
      rungIndex = 0
    },

    pin(candidateId: string) {
      if (!knows(candidateId)) return
      pinned = candidateId
    },

    beginSwitch() {
      if (switching) return false
      switching = true
      return true
    },

    endSwitch() {
      switching = false
    },

    escalate() {
      if (rungIndex < LADDER.length - 1) rungIndex++
    },

    embedPlayerUrls() {
      const urls = new Set<string>()
      for (const c of ranked) {
        if (c.embedPlayerUrl) urls.add(c.embedPlayerUrl)
      }
      return [...urls]
    },
  }
}
