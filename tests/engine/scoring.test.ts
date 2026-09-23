import { computeScore } from '../../src/main/engine/scoring'
import type { ReliabilityMetrics, HealthState } from '../../src/main/types'

// Helper to build a ReliabilityMetrics object
function makeMetrics(overrides: Partial<ReliabilityMetrics> = {}): ReliabilityMetrics {
  return {
    sourceId: 'test-source',
    league: 'nba',
    startupSuccesses: 0,
    startupFailures: 0,
    totalStartupTimeMs: 0,
    bufferEvents: 0,
    switchEvents: 0,
    totalSessions: 0,
    consecutiveFailures: 0,
    lastUpdated: Date.now(),
    ...overrides,
  }
}

// ─── Zero-history (null reliability) ─────────────────────────────────────────

describe('zero-history source (null reliability)', () => {
  it('uses 0.5 defaults for reliability_history, stability, startup_speed', () => {
    // reliability=null, quality=0.75, probeLatency=null, confidence=0.8, healthy
    // score = (0.50*0.5 + 0.20*0.5 + 0.15*0.75 + 0.10*0.5 + 0.05*0.8) * 1.0
    //       = (0.25 + 0.10 + 0.1125 + 0.05 + 0.04) * 1.0
    //       = 0.5525
    const expected = 0.50 * 0.5 + 0.20 * 0.5 + 0.15 * 0.75 + 0.10 * 0.5 + 0.05 * 0.8
    const score = computeScore(null, 0.75, null, 0.8, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })

  it('uses 0.5 for reliability_history with null reliability', () => {
    // Pure neutral: all 0.5, quality=0.5, confidence=0.5
    // = (0.50*0.5 + 0.20*0.5 + 0.15*0.5 + 0.10*0.5 + 0.05*0.5) * 1.0 = 0.5
    const score = computeScore(null, 0.5, null, 0.5, 'healthy')
    expect(score).toBeCloseTo(0.5, 4)
  })
})

// ─── Healthy source with history ──────────────────────────────────────────────

describe('healthy source with 9 successes / 1 failure', () => {
  it('computes correct weighted score', () => {
    const metrics = makeMetrics({
      startupSuccesses: 9,
      startupFailures: 1,
      totalStartupTimeMs: 18000,  // avg = 2000ms
      bufferEvents: 0,
      totalSessions: 10,
    })
    // reliability_history = 9 / 10 = 0.9
    // stability = 1 - 0/10 = 1.0
    // startup_speed: avg=2000ms → 1 - (2000-1000)/9000 = 1 - 1/9 ≈ 0.8889
    // quality = 0.9, confidence = 0.9, healthy
    const reliabilityHistory = 9 / 10
    const stability = 1.0
    const startupSpeed = 1 - (2000 - 1000) / 9000
    const expected = (0.50 * reliabilityHistory + 0.20 * stability + 0.15 * 0.9 + 0.10 * startupSpeed + 0.05 * 0.9) * 1.0
    const score = computeScore(metrics, 0.9, null, 0.9, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })
})

// ─── Health state multiplier ─────────────────────────────────────────────────

describe('health state multiplier', () => {
  const metrics = makeMetrics({
    startupSuccesses: 5,
    startupFailures: 5,
    totalStartupTimeMs: 25000,  // avg = 5000ms
    bufferEvents: 2,
    totalSessions: 10,
  })

  it('healthy multiplier = 1.0: no reduction', () => {
    const scoreHealthy = computeScore(metrics, 0.75, null, 0.8, 'healthy')
    const scoreRaw = computeScore(metrics, 0.75, null, 0.8, 'healthy')
    expect(scoreHealthy).toBeCloseTo(scoreRaw, 4)
  })

  it('unknown multiplier = 0.8: score is 0.8x healthy score', () => {
    const scoreHealthy = computeScore(metrics, 0.75, null, 0.8, 'healthy')
    const scoreUnknown = computeScore(metrics, 0.75, null, 0.8, 'unknown')
    expect(scoreUnknown).toBeCloseTo(scoreHealthy * 0.8, 4)
  })

  it('degraded multiplier = 0.6: score is 0.6x healthy score', () => {
    const scoreHealthy = computeScore(metrics, 0.75, null, 0.8, 'healthy')
    const scoreDegraded = computeScore(metrics, 0.75, null, 0.8, 'degraded')
    expect(scoreDegraded).toBeCloseTo(scoreHealthy * 0.6, 4)
  })

  it('unknown is less than healthy', () => {
    const scoreHealthy = computeScore(metrics, 0.75, null, 0.8, 'healthy')
    const scoreUnknown = computeScore(metrics, 0.75, null, 0.8, 'unknown')
    expect(scoreUnknown).toBeLessThan(scoreHealthy)
  })

  it('degraded is less than unknown', () => {
    const scoreUnknown = computeScore(metrics, 0.75, null, 0.8, 'unknown')
    const scoreDegraded = computeScore(metrics, 0.75, null, 0.8, 'degraded')
    expect(scoreDegraded).toBeLessThan(scoreUnknown)
  })
})

// ─── startup_speed bounds ─────────────────────────────────────────────────────

describe('startup_speed calculation', () => {
  function scoreWithStartup(avgMs: number): number {
    const metrics = makeMetrics({
      startupSuccesses: 1,
      startupFailures: 0,
      totalStartupTimeMs: avgMs,
      totalSessions: 1,
    })
    // Isolate startup_speed: use 0.5 quality and confidence, no buffers
    // stability = 1.0 (0 buffer / 1 session)
    // reliabilityHistory = 1.0 (1/1)
    return computeScore(metrics, 0.5, null, 0.5, 'healthy')
  }

  it('avg 1000ms → startup_speed = 1.0', () => {
    // startup_speed = 1 - (1000-1000)/9000 = 1.0
    // expected = 0.50*1.0 + 0.20*1.0 + 0.15*0.5 + 0.10*1.0 + 0.05*0.5 = 0.95
    const expected = 0.50 * 1.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.10 * 1.0 + 0.05 * 0.5
    expect(scoreWithStartup(1000)).toBeCloseTo(expected, 4)
  })

  it('avg 10000ms → startup_speed = 0.0', () => {
    // startup_speed = 1 - (10000-1000)/9000 = 0.0
    const expected = 0.50 * 1.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.10 * 0.0 + 0.05 * 0.5
    expect(scoreWithStartup(10000)).toBeCloseTo(expected, 4)
  })

  it('avg 5500ms → startup_speed ≈ 0.5', () => {
    // startup_speed = 1 - (5500-1000)/9000 = 1 - 4500/9000 = 0.5
    const expected = 0.50 * 1.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.10 * 0.5 + 0.05 * 0.5
    expect(scoreWithStartup(5500)).toBeCloseTo(expected, 4)
  })

  it('avg 500ms (below 1000) → startup_speed clamped to 1.0', () => {
    // 1 - (500-1000)/9000 = 1 - (-500/9000) = 1 + 0.0556 > 1 → clamped to 1.0
    const expected = 0.50 * 1.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.10 * 1.0 + 0.05 * 0.5
    expect(scoreWithStartup(500)).toBeCloseTo(expected, 4)
  })

  it('avg 15000ms (above 10000) → startup_speed clamped to 0.0', () => {
    // min(15000, 10000) = 10000 → startup_speed = 0.0 (same as 10000ms)
    const expected = 0.50 * 1.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.10 * 0.0 + 0.05 * 0.5
    expect(scoreWithStartup(15000)).toBeCloseTo(expected, 4)
  })
})

// ─── stability ────────────────────────────────────────────────────────────────

describe('stability calculation', () => {
  it('5 buffer events / 10 sessions → stability = 0.5', () => {
    const metrics = makeMetrics({
      startupSuccesses: 0,
      startupFailures: 0,
      bufferEvents: 5,
      totalSessions: 10,
    })
    // reliability_history = 0.5 (no history)
    // stability = 1 - 5/10 = 0.5
    // startup_speed = 0.5 (no history)
    const expected = (0.50 * 0.5 + 0.20 * 0.5 + 0.15 * 0.5 + 0.10 * 0.5 + 0.05 * 0.5) * 1.0
    const score = computeScore(metrics, 0.5, null, 0.5, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })

  it('15 buffer events / 10 sessions → stability clamped to 0', () => {
    const metrics = makeMetrics({
      startupSuccesses: 0,
      startupFailures: 0,
      bufferEvents: 15,
      totalSessions: 10,
    })
    // buffer_rate = 15/10 = 1.5 > 1 → stability = clamp(1 - 1.5, 0, 1) = 0
    const expected = (0.50 * 0.5 + 0.20 * 0.0 + 0.15 * 0.5 + 0.10 * 0.5 + 0.05 * 0.5) * 1.0
    const score = computeScore(metrics, 0.5, null, 0.5, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })

  it('0 total sessions → stability defaults to 0.5', () => {
    const metrics = makeMetrics({ bufferEvents: 5, totalSessions: 0 })
    // totalSessions = 0 → stability = 0.5
    const expected = (0.50 * 0.5 + 0.20 * 0.5 + 0.15 * 0.5 + 0.10 * 0.5 + 0.05 * 0.5) * 1.0
    const score = computeScore(metrics, 0.5, null, 0.5, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })
})

// ─── Component pass-through ───────────────────────────────────────────────────

describe('component pass-through', () => {
  it('video_quality 0.9 contributes 0.15 * 0.9 = 0.135', () => {
    // null reliability → all others 0.5
    // 0.50*0.5 + 0.20*0.5 + 0.15*0.9 + 0.10*0.5 + 0.05*0.5
    const expected = 0.50 * 0.5 + 0.20 * 0.5 + 0.15 * 0.9 + 0.10 * 0.5 + 0.05 * 0.5
    const score = computeScore(null, 0.9, null, 0.5, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })

  it('extraction_confidence 0.8 contributes 0.05 * 0.8 = 0.04', () => {
    // null reliability → all others 0.5
    // 0.50*0.5 + 0.20*0.5 + 0.15*0.5 + 0.10*0.5 + 0.05*0.8
    const expected = 0.50 * 0.5 + 0.20 * 0.5 + 0.15 * 0.5 + 0.10 * 0.5 + 0.05 * 0.8
    const score = computeScore(null, 0.5, null, 0.8, 'healthy')
    expect(score).toBeCloseTo(expected, 4)
  })
})

// ─── Degraded source with history ────────────────────────────────────────────

describe('degraded source with 5/5 ratio and buffer events', () => {
  it('computes correct score with degraded health multiplier', () => {
    const metrics = makeMetrics({
      startupSuccesses: 5,
      startupFailures: 5,
      totalStartupTimeMs: 30000,  // avg = 6000ms
      bufferEvents: 3,
      totalSessions: 10,
    })
    // reliability_history = 5/10 = 0.5
    // stability = 1 - 3/10 = 0.7
    // startup_speed = 1 - (6000-1000)/9000 = 1 - 5000/9000 ≈ 0.4444
    const reliabilityHistory = 0.5
    const stability = 0.7
    const startupSpeed = 1 - (6000 - 1000) / 9000
    const rawScore = 0.50 * reliabilityHistory + 0.20 * stability + 0.15 * 0.75 + 0.10 * startupSpeed + 0.05 * 0.8
    const expected = rawScore * 0.6
    const score = computeScore(metrics, 0.75, null, 0.8, 'degraded')
    expect(score).toBeCloseTo(expected, 4)
  })
})
