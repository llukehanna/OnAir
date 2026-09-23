import { createStallMachine, STALL_THRESHOLD_MS } from '../../src/renderer/src/playback/stall-machine'

// ---------------------------------------------------------------------------
// The stall machine exists for one reason: hls.js emits BUFFER_STALL_ERROR
// repeatedly while a stream is starved. Without an explicit state gate, each
// event arms its own timer and every one of them fires a failover.
// ---------------------------------------------------------------------------

describe('stall machine', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('defaults its threshold to the documented 3s', () => {
    expect(STALL_THRESHOLD_MS).toBe(3000)
  })

  it('starts in watching', () => {
    const m = createStallMachine({ onStallTimeout: jest.fn() })
    expect(m.state).toBe('watching')
  })

  it('transitions to stalled on a stall signal', () => {
    const m = createStallMachine({ onStallTimeout: jest.fn() })
    m.onStall()
    expect(m.state).toBe('stalled')
  })

  it('fires the timeout callback once the threshold elapses', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
    void m
  })

  it('does not fire before the threshold elapses', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS - 1)
    expect(onStallTimeout).not.toHaveBeenCalled()
    void m
  })

  it('honors a custom threshold', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout, thresholdMs: 1500 })
    m.onStall()
    jest.advanceTimersByTime(1500)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
    void m
  })

  // -- the whole point ------------------------------------------------------

  it('arms only one timer across repeated stall signals', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    m.onStall()
    m.onStall()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
    void m
  })

  it('does not re-arm after firing, so one stall episode yields one failover', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    m.onStall()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS * 4)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
  })

  // -- recovery -------------------------------------------------------------

  it('returns to watching when progress resumes', () => {
    const m = createStallMachine({ onStallTimeout: jest.fn() })
    m.onStall()
    m.onProgress()
    expect(m.state).toBe('watching')
  })

  it('cancels the pending timeout when progress resumes', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS - 100)
    m.onProgress()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).not.toHaveBeenCalled()
  })

  it('can stall again after recovering', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    m.onProgress()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
  })

  it('re-arms after a fired episode once progress resumes', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    m.onProgress()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).toHaveBeenCalledTimes(2)
  })

  it('ignores progress signals while already watching', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onProgress()
    m.onProgress()
    expect(m.state).toBe('watching')
    jest.advanceTimersByTime(STALL_THRESHOLD_MS * 2)
    expect(onStallTimeout).not.toHaveBeenCalled()
  })

  // -- stream handoff -------------------------------------------------------

  it('reset() returns to watching', () => {
    const m = createStallMachine({ onStallTimeout: jest.fn() })
    m.onStall()
    m.reset()
    expect(m.state).toBe('watching')
  })

  it('reset() cancels a pending timer so it cannot fire against a new stream', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS - 1)
    m.reset()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS * 3)
    expect(onStallTimeout).not.toHaveBeenCalled()
  })

  it('is usable again after reset', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    m.reset()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS)
    expect(onStallTimeout).toHaveBeenCalledTimes(1)
  })

  it('dispose() cancels any pending timer', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.onStall()
    m.dispose()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS * 3)
    expect(onStallTimeout).not.toHaveBeenCalled()
  })

  it('ignores signals after dispose', () => {
    const onStallTimeout = jest.fn()
    const m = createStallMachine({ onStallTimeout })
    m.dispose()
    m.onStall()
    jest.advanceTimersByTime(STALL_THRESHOLD_MS * 3)
    expect(onStallTimeout).not.toHaveBeenCalled()
  })
})
