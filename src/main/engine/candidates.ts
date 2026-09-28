import Database from 'better-sqlite3'
import type { Game, StreamCandidate, HealthState } from '../types'
import type { SourceAdapter, RawStreamCandidate } from '../adapters/base'
import type { PlaywrightPool } from '../adapters/pool'
import { getAllAdapters } from '../adapters/registry'
import { getSourceById } from '../db/queries/sources'
import { getReliability } from '../db/queries/reliability'
import { matchGame } from './matcher'
import { probeCandidate } from './prober'
import { computeScore } from './scoring'

// ---------------------------------------------------------------------------
// Internal pipeline type
// ---------------------------------------------------------------------------

interface PipelineCandidate {
  sourceId: string
  sourceDomain: string
  healthState: HealthState
  raw: RawStreamCandidate
  matcherConfidence: number
  finalConfidence: number  // raw.extractionConfidence * matcherConfidence
}

// ---------------------------------------------------------------------------
// collectAndRankCandidates
// ---------------------------------------------------------------------------

/**
 * The core candidate collection pipeline:
 *
 * 1. Get adapters → filter broken/blocked sources
 * 2. Call getCandidateStreams concurrently on all eligible adapters
 * 3. Apply game matcher, compose confidence, filter below 0.5 threshold
 * 4. Probe all candidates in parallel via Promise.allSettled
 * 5. Score and sort descending
 *
 * Returns [] (not throw) if all adapters fail.
 */
export async function collectAndRankCandidates(
  game: Game,
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[]
): Promise<StreamCandidate[]> {
  // ── Step 1: Get adapters and filter by health ─────────────────────────────
  const adapters = (adaptersFn ?? getAllAdapters)()
  const eligible: { adapter: SourceAdapter; source: ReturnType<typeof getSourceById> & {} }[] = []

  console.log(`[candidates] game=${game.gameId} league=${game.league} adapters=${adapters.length}`)

  for (const adapter of adapters) {
    if (!adapter.supportedLeagues.includes(game.league)) {
      console.log(`[candidates] skip ${adapter.sourceId}: league ${game.league} not in ${adapter.supportedLeagues}`)
      continue
    }
    const source = getSourceById(adapter.sourceId, db)
    if (!source) {
      console.log(`[candidates] skip ${adapter.sourceId}: not found in DB`)
      continue
    }
    if (source.healthState === 'broken' || source.healthState === 'blocked') {
      console.log(`[candidates] skip ${adapter.sourceId}: healthState=${source.healthState}`)
      continue
    }
    eligible.push({ adapter, source })
  }
  console.log(`[candidates] eligible adapters: ${eligible.map(e => e.adapter.sourceId)}`)

  // ── Step 2: Call getCandidateStreams concurrently ─────────────────────────
  // Use streaming approach: process adapter results as they arrive.
  // This minimizes latency between URL capture and playback — critical because
  // stream tokens expire quickly (30-60s).
  const pipeline: PipelineCandidate[] = []
  let resolveEarly: (() => void) | null = null
  const earlyPromise = new Promise<void>((resolve) => { resolveEarly = resolve })

  const adapterPromises = eligible.map(async ({ adapter, source }) => {
    console.log(`[candidates] calling ${adapter.sourceId}.getCandidateStreams pool=${!!pool}`)
    try {
      const raws = pool
        ? await adapter.getCandidateStreams(game, pool)
        : await adapter.getCandidateStreams(game, undefined as unknown as PlaywrightPool)
      console.log(`[candidates] ${adapter.sourceId} returned ${raws.length} raws`)

      // Process results immediately as they arrive (Step 3 inline)
      for (const raw of raws) {
        // Prefer the adapter-reported listing text (matchText) over the raw
        // stream URL: a CDN path never names teams, so URL-only matching
        // silently dropped every non-event_first source's candidate.
        const matcherConfidence = source.classification === 'event_first'
          ? 1.0
          : matchGame(game, raw.matchText ?? raw.streamUrl)
        if (matcherConfidence < 0.5) continue
        const finalConfidence = raw.extractionConfidence * matcherConfidence
        pipeline.push({
          sourceId: adapter.sourceId,
          sourceDomain: source.baseUrl,
          healthState: source.healthState,
          raw,
          matcherConfidence,
          finalConfidence,
        })
      }
      // Signal early completion when we have viable candidates
      if (pipeline.length > 0 && resolveEarly) {
        console.log(`[candidates] early signal: ${pipeline.length} candidates from ${adapter.sourceId}`)
        resolveEarly()
        resolveEarly = null
      }
      return { adapter, source, raws }
    } catch (err) {
      console.error(`[candidates] ${adapter.sourceId} rejected:`, err)
      return { adapter, source, raws: [] as RawStreamCandidate[] }
    }
  })

  // Wait for first viable candidates OR all adapters to finish (max 20s for stragglers)
  await Promise.race([
    Promise.allSettled(adapterPromises),
    earlyPromise.then(() => new Promise<void>(r => setTimeout(r, 2000))), // 2s grace after first candidate
  ])

  console.log(`[candidates] pipeline before probe: ${pipeline.length} candidates from sources: ${[...new Set(pipeline.map(p => p.sourceId))]}`)
  if (pipeline.length === 0) {
    console.warn(`[candidates] no pipeline candidates after waiting for all adapters`)
  }

  // ── Step 4: Probe all candidates in parallel ──────────────────────────────
  const probeResults = await Promise.allSettled(
    pipeline.map(pc =>
      probeCandidate(
        {
          gameId: game.gameId,
          sourceId: pc.sourceId,
          // Use refererUrl from raw candidate if available (e.g. a source that links out to an external player page)
          // so the CDN receives the correct Referer it expects, not the adapter's base URL.
          sourceDomain: pc.raw.refererUrl ?? pc.sourceDomain,
          raw: pc.raw,
        },
        fetchFn,
        db
      )
    )
  )

  const probeSuccessCount = probeResults.filter(r => r.status === 'fulfilled' && r.value !== null).length
  console.log(`[candidates] probe results: ${probeSuccessCount}/${pipeline.length} succeeded`)
  if (probeSuccessCount === 0 && pipeline.length > 0) {
    console.warn(`[candidates] all probes failed — URLs may require specific Referer or be expired`)
  }

  // ── Step 5: Score and rank ────────────────────────────────────────────────
  const ranked: StreamCandidate[] = []

  for (let i = 0; i < pipeline.length; i++) {
    const probeResult = probeResults[i]
    if (probeResult.status === 'rejected') continue

    const probe = probeResult.value
    if (!probe) continue  // probe failed -> drop candidate

    const pc = pipeline[i]
    const reliability = getReliability(pc.sourceId, game.league, db)
    const score = computeScore(
      reliability,
      probe.qualityScore,
      probe.probeLatencyMs,
      pc.finalConfidence,
      pc.healthState
    )

    ranked.push({
      candidateId: `${pc.sourceId}_${game.gameId}_${Date.now()}_${i}`,
      gameId: game.gameId,
      sourceId: pc.sourceId,
      streamUrl: probe.streamUrl,
      streamType: probe.streamType,
      quality: probe.quality,
      score,
      probedAt: Date.now(),
      probeSuccess: true,
      probeLatencyMs: probe.probeLatencyMs,
      refererUrl: pc.raw.refererUrl ?? null,
      cdnOrigin: pc.raw.cdnOrigin ?? null,
      cdnReferer: pc.raw.cdnReferer ?? null,
      browserContext: pc.raw.browserContext,
      manifestBody: pc.raw.manifestBody,
      embedPlayerUrl: pc.raw.embedPlayerUrl,
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  console.log(`[candidates] final ranked count: ${ranked.length}`)
  return ranked
}
