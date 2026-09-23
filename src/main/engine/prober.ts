import Database from 'better-sqlite3'
import type { StreamType } from '../types'
import type { RawStreamCandidate } from '../adapters/base'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeInput {
  gameId: string
  sourceId: string
  sourceDomain: string  // e.g. 'https://source-a.example' for Referer header
  raw: RawStreamCandidate
}

export interface ProbeResult {
  streamUrl: string
  streamType: StreamType
  quality: string | null
  qualityScore: number
  probeLatencyMs: number
  probeSuccess: true
}

// ---------------------------------------------------------------------------
// parseQuality
// ---------------------------------------------------------------------------

/**
 * Parse an HLS master manifest body to determine stream quality.
 * Returns a quality score (0-1) and human-readable label.
 *
 * Priority: RESOLUTION tag > BANDWIDTH tag > default.
 */
export function parseQuality(manifestBody: string): { score: number; label: string | null } {
  const heights = [...manifestBody.matchAll(/RESOLUTION=\d+x(\d+)/g)]
    .map(m => parseInt(m[1], 10))

  if (heights.length > 0) {
    const maxHeight = Math.max(...heights)
    if (maxHeight >= 2160) return { score: 1.0, label: '2160p' }
    if (maxHeight >= 1080) return { score: 0.9, label: '1080p' }
    if (maxHeight >= 720) return { score: 0.75, label: '720p' }
    if (maxHeight >= 480) return { score: 0.55, label: '480p' }
    return { score: 0.35, label: `${maxHeight}p` }
  }

  const bandwidths = [...manifestBody.matchAll(/BANDWIDTH=(\d+)/g)]
    .map(m => parseInt(m[1], 10))

  if (bandwidths.length > 0) return { score: 0.75, label: null }

  return { score: 0.5, label: null }
}

// ---------------------------------------------------------------------------
// fetchManifest (internal)
// ---------------------------------------------------------------------------

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function fetchManifest(
  url: string,
  refererDomain: string,
  fetchFn: typeof fetch = fetch
): Promise<{ body: string; latencyMs: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  const start = Date.now()

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': '*/*',
        'Referer': refererDomain,
      },
    })

    if (!response.ok) return null

    const body = await response.text()
    return { body, latencyMs: Date.now() - start }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// writeProbeResult (internal)
// ---------------------------------------------------------------------------

interface WriteParams {
  gameId: string
  sourceId: string
  streamUrl: string
  streamType: StreamType
  quality: string | null
  score: number
  probeSuccess: boolean
  probeLatencyMs: number | null
}

function writeProbeResult(params: WriteParams, d: Database.Database): void {
  const insertTx = d.transaction(() => {
    d.prepare(`
      INSERT INTO stream_candidates
        (game_id, source_id, stream_url, stream_type, quality, score, probe_success, probe_latency_ms, probed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.gameId,
      params.sourceId,
      params.streamUrl,
      params.streamType,
      params.quality,
      params.score,
      params.probeSuccess ? 1 : 0,
      params.probeLatencyMs,
      Date.now()
    )

    d.prepare(`
      INSERT INTO events (event_type, game_id, source_id, details, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'probe_result',
      params.gameId,
      params.sourceId,
      JSON.stringify({
        streamUrl: params.streamUrl,
        quality: params.quality,
        probeSuccess: params.probeSuccess,
        probeLatencyMs: params.probeLatencyMs,
      }),
      Date.now()
    )
  })

  insertTx()
}

// ---------------------------------------------------------------------------
// probeCandidate (exported)
// ---------------------------------------------------------------------------

/**
 * Probe a raw stream candidate by fetching its manifest via GET.
 *
 * - Uses AbortController with 5s timeout
 * - Sends browser-like headers (User-Agent, Accept, Referer)
 * - Parses RESOLUTION/BANDWIDTH tags to determine quality
 * - Logs result to stream_candidates + events in a single transaction (if db provided)
 * - Returns null if probe fails or times out (candidate is dropped)
 */
export async function probeCandidate(
  input: ProbeInput,
  fetchFn: typeof fetch = fetch,
  db?: Database.Database
): Promise<ProbeResult | null> {
  // If the adapter already probed via Playwright session context, use that directly.
  // Plain fetch from Node.js lacks the cookies/session the CDN requires.
  if (input.raw.preProbed) {
    const pp = input.raw.preProbed
    if (db) {
      writeProbeResult({
        gameId: input.gameId,
        sourceId: input.sourceId,
        streamUrl: input.raw.streamUrl,
        streamType: input.raw.streamType,
        quality: pp.quality,
        score: pp.qualityScore,
        probeSuccess: true,
        probeLatencyMs: pp.probeLatencyMs,
      }, db)
    }
    return {
      streamUrl: input.raw.streamUrl,
      streamType: input.raw.streamType,
      quality: pp.quality,
      qualityScore: pp.qualityScore,
      probeLatencyMs: pp.probeLatencyMs,
      probeSuccess: true,
    }
  }

  const result = await fetchManifest(input.raw.streamUrl, input.sourceDomain, fetchFn)

  if (!result) {
    // Failed probe — write failure record if db provided
    if (db) {
      writeProbeResult({
        gameId: input.gameId,
        sourceId: input.sourceId,
        streamUrl: input.raw.streamUrl,
        streamType: input.raw.streamType,
        quality: null,
        score: 0,
        probeSuccess: false,
        probeLatencyMs: null,
      }, db)
    }
    return null
  }

  const { body, latencyMs } = result
  const { score, label } = parseQuality(body)

  if (db) {
    writeProbeResult({
      gameId: input.gameId,
      sourceId: input.sourceId,
      streamUrl: input.raw.streamUrl,
      streamType: input.raw.streamType,
      quality: label,
      score,
      probeSuccess: true,
      probeLatencyMs: latencyMs,
    }, db)
  }

  return {
    streamUrl: input.raw.streamUrl,
    streamType: input.raw.streamType,
    quality: label,
    qualityScore: score,
    probeLatencyMs: latencyMs,
    probeSuccess: true,
  }
}
