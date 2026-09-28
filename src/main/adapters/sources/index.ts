import Database from 'better-sqlite3'
import type { Source } from '../../types'
import type { SourceAdapter } from '../base'
import { register } from '../registry'
import { addSource, getSourceById, updateSource } from '../../db/queries/sources'
import { NtvStAdapter } from './ntv-st'
import { ZliveStAdapter } from './zlive-st'
import { Streamsports99Adapter } from './streamsports99-ru'
import { FamelackAdapter } from './famelack-com'
import { Tvapp1Adapter, TheTvAppPlusAdapter, TheTvAppStAdapter } from './thetvapp'

// ---------------------------------------------------------------------------
// Built-in third-party sources
//
// Every adapter here must also have a row in the sources table — the
// candidate pipeline skips any adapter whose row is missing or unhealthy
// (upsertFixtureSource() shows the same pattern). Rows are seeded at
// startup, idempotently:
//
//   - no row           -> insert (enabled, needsAdapter false)
//   - row, needsAdapter true  -> a host previously pasted via bulk-add that
//                                was waiting for its adapter: adopt it by
//                                applying the adapter's declared metadata
//   - row, needsAdapter false -> already adapter-backed or hand-edited by the
//                                operator: never clobber it
//
// Adding a new built-in source: create the adapter file, add it to
// BUILTIN_ADAPTERS. Registration and seeding follow automatically.
// ---------------------------------------------------------------------------

export const BUILTIN_ADAPTERS: SourceAdapter[] = [
  new NtvStAdapter(),
  new ZliveStAdapter(),
  new Streamsports99Adapter(),
  new FamelackAdapter(),
  new Tvapp1Adapter(),
  new TheTvAppPlusAdapter(),
  new TheTvAppStAdapter(),
]

/** The sources-table row a built-in adapter expects to exist. */
function rowForAdapter(adapter: SourceAdapter, existing: Source | null): Source {
  return {
    sourceId: adapter.sourceId,
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    classification: adapter.classification,
    supportedLeagues: adapter.supportedLeagues,
    extractionMethod: adapter.extractionMethod,
    confidenceWeight: adapter.confidenceWeight,
    // Runtime observations (health, enabled, addedAt) belong to the operator
    // and the health checker, never to the seed.
    healthState: existing?.healthState ?? 'unknown',
    healthUpdatedAt: existing?.healthUpdatedAt ?? null,
    enabled: existing?.enabled ?? true,
    needsAdapter: false,
    addedAt: existing?.addedAt ?? Date.now(),
  }
}

/** Inserts the sources rows every built-in adapter needs, idempotently. */
export function ensureBuiltinSourceRows(db?: Database.Database): void {
  for (const adapter of BUILTIN_ADAPTERS) {
    const existing = getSourceById(adapter.sourceId, db)

    if (!existing) {
      addSource(rowForAdapter(adapter, null), db)
      continue
    }

    // A hand-pasted host (needsAdapter true) was inert pending an adapter.
    // Now that one exists, adopt it. An already adapter-backed or hand-edited
    // row is left untouched — seeding must never clobber operator edits.
    if (existing.needsAdapter) {
      updateSource(
        adapter.sourceId,
        {
          name: adapter.name,
          baseUrl: adapter.baseUrl,
          classification: adapter.classification,
          supportedLeagues: adapter.supportedLeagues,
          extractionMethod: adapter.extractionMethod,
          confidenceWeight: adapter.confidenceWeight,
          needsAdapter: false,
        },
        db
      )
    }
  }
}

/** Seeds the sources rows and registers every built-in adapter. */
export function registerBuiltinSources(db?: Database.Database): void {
  ensureBuiltinSourceRows(db)
  for (const adapter of BUILTIN_ADAPTERS) {
    register(adapter)
  }
}
