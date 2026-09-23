import Database from 'better-sqlite3'
import type { Game, StreamCandidate } from '../types'
import type { PlaywrightPool } from '../adapters/pool'
import type { SourceAdapter } from '../adapters/base'
import { collectAndRankCandidates } from './candidates'

/**
 * Public facade for the stream engine.
 *
 * Downstream callers (warmer, playback) import from this module only and never
 * reach into internal engine sub-modules (candidates, matcher, scoring, prober).
 *
 * Returns a ranked StreamCandidate[] sorted by score descending.
 * Returns [] (not throw) when all adapters fail or no candidates survive.
 */
export async function getStreamCandidates(
  game: Game,
  pool?: PlaywrightPool,
  db?: Database.Database,
  fetchFn?: typeof fetch,
  adaptersFn?: () => SourceAdapter[]
): Promise<StreamCandidate[]> {
  return collectAndRankCandidates(game, pool, db, fetchFn, adaptersFn)
}
