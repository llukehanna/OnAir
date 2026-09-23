import type { ReliabilityMetrics, HealthState } from '../types'

/**
 * Computes a reliability score (0–1) for a stream candidate.
 *
 * Formula:
 *   score = (
 *     0.50 × reliability_history
 *   + 0.20 × stability
 *   + 0.15 × videoQuality
 *   + 0.10 × startup_speed
 *   + 0.05 × extractionConfidence
 *   ) × health_multiplier
 *
 * Components with no historical data default to 0.5 (neutral).
 *
 * @param reliability       Historical metrics from the DB, or null for new sources
 * @param videoQuality      0–1 derived from HLS manifest RESOLUTION tag
 * @param probeLatencyMs    Probe latency in ms (unused here; startup_speed uses
 *                          the historical average from `reliability`)
 * @param extractionConfidence  adapterConfidence × matcherConfidence (0–1)
 * @param healthState       Source health at collection time
 */
export function computeScore(
  reliability: ReliabilityMetrics | null,
  videoQuality: number,
  _probeLatencyMs: number | null,
  extractionConfidence: number,
  healthState: HealthState
): number {
  // ── reliability_history ──────────────────────────────────────────────────
  const successes = reliability?.startupSuccesses ?? 0
  const failures = reliability?.startupFailures ?? 0
  const reliabilityHistory = (successes + failures) === 0
    ? 0.5
    : successes / (successes + failures)

  // ── stability ────────────────────────────────────────────────────────────
  const totalSessions = reliability?.totalSessions ?? 0
  const bufferEvents = reliability?.bufferEvents ?? 0
  const stability = totalSessions === 0
    ? 0.5
    : Math.max(0, Math.min(1, 1 - bufferEvents / totalSessions))

  // ── startup_speed ────────────────────────────────────────────────────────
  // Uses historical average, not current probe latency.
  // 1000ms → 1.0,  10000ms → 0.0; linearly interpolated and clamped.
  const avgStartupMs = reliability && reliability.startupSuccesses > 0
    ? reliability.totalStartupTimeMs / reliability.startupSuccesses
    : null
  const startupSpeed = avgStartupMs === null
    ? 0.5
    : Math.max(0, Math.min(1, 1 - (Math.min(avgStartupMs, 10_000) - 1000) / 9000))

  // ── weighted sum ─────────────────────────────────────────────────────────
  const rawScore =
    0.50 * reliabilityHistory +
    0.20 * stability +
    0.15 * videoQuality +
    0.10 * startupSpeed +
    0.05 * extractionConfidence

  // ── health multiplier ────────────────────────────────────────────────────
  const multiplier = healthState === 'healthy' ? 1.0
    : healthState === 'unknown' ? 0.8
    : 0.6  // degraded (blocked/broken are filtered before collection)

  return rawScore * multiplier
}
