import path from 'node:path'
import { app } from 'electron'
import type { Game, HealthState, LeagueId } from '../types'
import type { SourceAdapter, RawStreamCandidate } from '../adapters/base'
import type { PlaywrightPool } from '../adapters/pool'
import { startHlsFixture, type HlsFixture, type FailureMode } from './hls-fixture'
import { addSource, getSourceById } from '../db/queries/sources'

// ---------------------------------------------------------------------------
// Development fixture source
//
// Serves two locally-generated HLS streams as if they were a real source, so
// the whole pipeline — acquisition, ranking, playback, the failover ladder,
// continuity, the terminal state — can be exercised in the real UI without any
// external source at all.
//
// Failures are injected on command rather than waited for, which makes the
// behaviour the engine was built for observable in seconds:
//
//   window.onair.fixtureSetMode('stall')        -> stall detection + failover
//   window.onair.fixtureSetMode('segment-403')  -> token expiry -> re-extract
//   window.onair.fixtureSetMode('off-air')      -> frozen live edge detection
//   window.onair.fixtureSetMode('manifest-404') -> source gone -> next candidate
//
// Enabled only when ONAIR_FIXTURE=1. Never registered otherwise.
// ---------------------------------------------------------------------------

/**
 * Two distinct streams so a failover has somewhere real to land.
 *
 * Resolved from app.getAppPath() rather than __dirname: the compiled main
 * process lives in out/main, so counting directories upward is one wrong guess
 * away from silently pointing outside the project.
 */
function mediaRoot(): string {
  return path.join(app.getAppPath(), 'tests', 'fixtures', 'media')
}

let primary: HlsFixture | null = null
let secondary: HlsFixture | null = null

export function isFixtureModeEnabled(): boolean {
  return process.env.ONAIR_FIXTURE === '1'
}

export async function startFixtureServers(): Promise<void> {
  if (primary) return
  const root = mediaRoot()
  try {
    // Program dates on both, from the same start, so a switch between them can
    // align on wall-clock time the way continuity does with real broadcasts.
    // autoAdvance, because nothing else moves the live edge in the running app:
    // without it a 'healthy' stream is indistinguishable from an off-air one,
    // and the liveness monitor rightly fails it over.
    const shared = { windowSize: 6, programDateTime: true, autoAdvance: true }
    primary = await startHlsFixture({ ...shared, mediaDir: path.join(root, 'a') })
    secondary = await startHlsFixture({ ...shared, mediaDir: path.join(root, 'b') })
  } catch (err) {
    // Dev-only scaffolding must never take the app down with it.
    console.error(`[fixture] failed to start from ${root}:`, err)
    await stopFixtureServers()
    return
  }
  console.log(`[fixture] primary=${primary.masterUrl} secondary=${secondary.masterUrl}`)
}

export async function stopFixtureServers(): Promise<void> {
  await primary?.close()
  await secondary?.close()
  primary = null
  secondary = null
}

/**
 * Applies a failure mode to the primary stream. The secondary is left healthy
 * so the ladder has a working candidate to move to.
 */
export function setFixtureMode(mode: FailureMode): void {
  primary?.setMode(mode)
  console.log(`[fixture] primary mode -> ${mode}`)
}

export function getFixtureMode(): FailureMode | null {
  return primary?.getMode() ?? null
}

/** Advances the live edge immediately, on top of the fixture's own timer. */
export function advanceFixture(count = 1): void {
  primary?.advance(count)
  secondary?.advance(count)
}

/**
 * Ensures the fixture has a sources row.
 *
 * collectAndRankCandidates() filters adapters against the sources table and
 * skips any whose row is missing or unhealthy, so an adapter alone is not
 * enough to get candidates through the pipeline.
 */
export function upsertFixtureSource(): void {
  if (getSourceById('dev-fixture')) return
  addSource({
    sourceId: 'dev-fixture',
    name: 'Dev Fixture',
    baseUrl: 'http://127.0.0.1',
    classification: 'event_first',
    supportedLeagues: ['nba', 'nfl', 'cbb', 'cfb'],
    extractionMethod: 'network_intercept',
    confidenceWeight: 1.0,
    healthState: 'healthy',
    healthUpdatedAt: Date.now(),
    enabled: true,
    needsAdapter: false,
    addedAt: Date.now(),
  })
}

export class FixtureAdapter implements SourceAdapter {
  readonly sourceId = 'dev-fixture'
  readonly name = 'Dev Fixture'
  readonly baseUrl = 'http://127.0.0.1'
  readonly classification = 'event_first' as const
  readonly supportedLeagues: LeagueId[] = ['nba', 'nfl', 'cbb', 'cfb']
  readonly extractionMethod = 'network_intercept' as const
  readonly confidenceWeight = 1.0

  async getCandidateStreams(_game: Game, _pool: PlaywrightPool): Promise<RawStreamCandidate[]> {
    if (!primary || !secondary) return []

    // Ranked so the primary is chosen first and the secondary is what failover
    // lands on. Both are real, playable HLS.
    return [
      {
        streamUrl: primary.masterUrl,
        streamType: 'hls',
        quality: '720p',
        extractionConfidence: 0.95,
        refererUrl: primary.masterUrl,
      },
      {
        streamUrl: secondary.masterUrl,
        streamType: 'hls',
        quality: '720p',
        extractionConfidence: 0.85,
        refererUrl: secondary.masterUrl,
      },
    ]
  }

  async getSourceHealth(_pool: PlaywrightPool): Promise<HealthState> {
    return primary ? 'healthy' : 'broken'
  }
}
