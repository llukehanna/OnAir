import type Database from 'better-sqlite3'
import type { SourceAdapter } from '../adapters/base'
import type { PlaywrightPool } from '../adapters/pool'
import type { Channel, ChannelCategory } from '../types'
import { canonicalChannel } from './canonical'
import { getChannels, pruneChannelLinksForSource, upsertChannelLinks } from '../db/queries/channels'

// ---------------------------------------------------------------------------
// Channel discovery scheduler
//
// Mirrors discovery/scheduler.ts's shape (run now, then on an interval,
// never let one failure kill the loop) but for 24/7 channels instead of
// games: ask every adapter that has a channel listing for it, canonicalize
// what comes back, and persist it. A source with no listing (listChannels
// absent) or a broken one (throws, or returns []) is simply skipped — the
// other sources' channels still land.
// ---------------------------------------------------------------------------

const DISCOVERY_INTERVAL_MS = 30 * 60_000
const PRUNE_AGE_MS = 24 * 60 * 60_000

let timeoutHandle: ReturnType<typeof setTimeout> | null = null

/**
 * Runs one discovery pass: listChannels() on every adapter that has it,
 * canonicalize + upsert what's non-null, prune links not seen in 24h, return
 * the resulting channel list. Exported directly (not just used by the
 * scheduler loop) so tests and the 'refresh-channels' IPC handler can trigger
 * a pass on demand.
 */
export async function discoverOnce(
  pool: PlaywrightPool,
  adapters: () => SourceAdapter[],
  db?: Database.Database
): Promise<Channel[]> {
  for (const adapter of adapters()) {
    if (!adapter.listChannels) continue

    try {
      const listings = await adapter.listChannels(pool)

      const links: Array<{ channelId: string; name: string; category: ChannelCategory; url: string; label: string }> = []
      for (const listing of listings) {
        const canon = canonicalChannel(listing.label)
        if (!canon) continue
        links.push({
          channelId: canon.channelId,
          name: canon.name,
          category: canon.category,
          url: listing.url,
          label: listing.label,
        })
      }

      upsertChannelLinks(adapter.sourceId, links, undefined, db)

      // Prune this source's own stale links only when this pass actually
      // listed something — a failed/blocked pass returns [] and is not
      // evidence the source's previously-seen channels are gone, so its
      // links must survive past 24h until a pass proves otherwise.
      if (listings.length > 0) {
        pruneChannelLinksForSource(adapter.sourceId, PRUNE_AGE_MS, undefined, db)
      }
    } catch (err) {
      // One source's listing breaking must never cost the others theirs.
      console.warn(`[channels] ${adapter.sourceId} listChannels failed:`, err)
    }
  }

  return getChannels(db)
}

/**
 * Starts channel discovery: runs immediately, then every 30 minutes.
 * `db` is an optional override for tests — production callers omit it and
 * get the real connection discoverOnce() falls back to.
 */
export function startChannelDiscovery(
  pool: PlaywrightPool,
  adapters: () => SourceAdapter[],
  onUpdate: (channels: Channel[]) => void,
  db?: Database.Database
): void {
  const run = (): void => {
    discoverOnce(pool, adapters, db)
      .then(onUpdate)
      .catch((err) => console.error('[channels] discovery run threw unexpectedly:', err))
      .finally(() => {
        timeoutHandle = setTimeout(run, DISCOVERY_INTERVAL_MS)
      })
  }
  run()
}

export function stopChannelDiscovery(): void {
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
}
