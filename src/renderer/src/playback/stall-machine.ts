// ---------------------------------------------------------------------------
// Stall detection state machine
//
// hls.js emits BUFFER_STALL_ERROR repeatedly while a stream is starved, not
// once. Handling each event directly means every one of them arms a timer and
// every timer fires a failover — a single stall becomes a cascade of switches.
//
// This machine makes the state explicit so a stall episode produces exactly one
// failover request:
//
//   watching --onStall--> stalled --threshold elapsed--> onStallTimeout()
//      ^                     |
//      +-----onProgress------+
//
// While stalled, further stall signals are ignored. After the timeout fires the
// machine stays stalled and will not re-arm until progress resumes or the
// machine is reset, so a stream that never recovers cannot request a second
// failover for the same episode.
//
// reset() exists for stream handoff: a timer armed against the outgoing stream
// must never fire against the incoming one.
// ---------------------------------------------------------------------------

export type StallState = 'watching' | 'stalled'

/** Documented in docs/FAILOVER.md. Tunable; the empirical sweep sets the final value. */
export const STALL_THRESHOLD_MS = 3000

export interface StallMachineOptions {
  /** Called once when a stall outlasts the threshold. */
  onStallTimeout: () => void
  /** Milliseconds of continuous stall before failover is requested. */
  thresholdMs?: number
  /** Injectable for tests; defaults to the ambient timer functions. */
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
}

export interface StallMachine {
  readonly state: StallState
  /** Signal a buffer stall (hls.js BUFFER_STALL_ERROR). */
  onStall(): void
  /** Signal that media is flowing again (hls.js BUFFER_APPENDED). */
  onProgress(): void
  /** Return to watching and cancel any pending timer. For stream handoff. */
  reset(): void
  /** Permanently stop the machine and cancel any pending timer. */
  dispose(): void
}

export function createStallMachine(options: StallMachineOptions): StallMachine {
  const thresholdMs = options.thresholdMs ?? STALL_THRESHOLD_MS
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle))

  let state: StallState = 'watching'
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  return {
    get state() {
      return state
    },

    onStall() {
      if (disposed) return
      // Already stalled: the episode owns a timer, or has already fired for
      // this episode. Either way, do not arm another.
      if (state === 'stalled') return

      state = 'stalled'
      timer = setTimer(() => {
        // Left in 'stalled' on purpose: the state guard above is what prevents
        // a second failover request for the same unrecovered episode.
        timer = null
        options.onStallTimeout()
      }, thresholdMs)
    },

    onProgress() {
      if (disposed) return
      if (state === 'watching') return

      cancelTimer()
      state = 'watching'
    },

    reset() {
      if (disposed) return
      cancelTimer()
      state = 'watching'
    },

    dispose() {
      cancelTimer()
      disposed = true
    },
  }
}
