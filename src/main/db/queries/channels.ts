import Database from 'better-sqlite3'
import { getDb } from '../connection'
import type { Channel, ChannelCategory, ChannelSourceLink } from '../../types'

interface ChannelRow {
  channel_id: string
  name: string
  category: string
  last_seen_at: number
  source_count: number
}

interface ChannelSourceLinkRow {
  channel_id: string
  source_id: string
  url: string
  label: string
  seen_at: number
}

function rowToChannel(row: ChannelRow): Channel {
  return {
    channelId: row.channel_id,
    name: row.name,
    category: row.category as ChannelCategory,
    sourceCount: row.source_count,
    lastSeenAt: row.last_seen_at,
  }
}

function rowToLink(row: ChannelSourceLinkRow): ChannelSourceLink {
  return {
    channelId: row.channel_id,
    sourceId: row.source_id,
    url: row.url,
    label: row.label,
    seenAt: row.seen_at,
  }
}

/**
 * Records what one source's channel listing found: a channel (created or
 * refreshed) and that source's link to it. Only touches rows for `sourceId` —
 * another source's links to the same channel are untouched.
 *
 * A channel this source no longer lists is left in place with its old
 * seen_at rather than deleted here; pruneChannelLinks reaps it on age.
 */
export function upsertChannelLinks(
  sourceId: string,
  links: Array<{ channelId: string; name: string; category: ChannelCategory; url: string; label: string }>,
  now?: number,
  db?: Database.Database
): void {
  const d = db ?? getDb()
  const at = now ?? Date.now()

  const upsertChannel = d.prepare(`
    INSERT INTO channels (channel_id, name, category, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      last_seen_at = excluded.last_seen_at
  `)

  const upsertLink = d.prepare(`
    INSERT INTO channel_sources (channel_id, source_id, url, label, seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, source_id) DO UPDATE SET
      url = excluded.url,
      label = excluded.label,
      seen_at = excluded.seen_at
  `)

  const run = d.transaction((rows: typeof links) => {
    for (const link of rows) {
      upsertChannel.run(link.channelId, link.name, link.category, at)
      upsertLink.run(link.channelId, sourceId, link.url, link.label, at)
    }
  })
  run(links)
}

/**
 * Deletes links not refreshed within `olderThanMs`, then any channel left
 * with no links at all (a channel dropped by every source that once had it).
 */
export function pruneChannelLinks(olderThanMs: number, now?: number, db?: Database.Database): void {
  const d = db ?? getDb()
  const cutoff = (now ?? Date.now()) - olderThanMs

  d.prepare('DELETE FROM channel_sources WHERE seen_at < ?').run(cutoff)
  d.prepare(`
    DELETE FROM channels
    WHERE channel_id NOT IN (SELECT DISTINCT channel_id FROM channel_sources)
  `).run()
}

/**
 * Same as pruneChannelLinks, but scoped to one source's own links. Callers
 * (the channel scheduler) only invoke this for a source whose discovery pass
 * just listed at least one channel — a pass that returned [] (blocked,
 * timed out, site down) is not evidence the source's previously-seen
 * channels are actually gone, so its links must be left alone regardless of
 * age until a pass proves otherwise.
 */
export function pruneChannelLinksForSource(
  sourceId: string,
  olderThanMs: number,
  now?: number,
  db?: Database.Database
): void {
  const d = db ?? getDb()
  const cutoff = (now ?? Date.now()) - olderThanMs

  d.prepare('DELETE FROM channel_sources WHERE source_id = ? AND seen_at < ?').run(sourceId, cutoff)
  d.prepare(`
    DELETE FROM channels
    WHERE channel_id NOT IN (SELECT DISTINCT channel_id FROM channel_sources)
  `).run()
}

export function getChannels(db?: Database.Database): Channel[] {
  const d = db ?? getDb()
  const rows = d.prepare(`
    SELECT c.channel_id, c.name, c.category, c.last_seen_at,
           (SELECT COUNT(*) FROM channel_sources cs WHERE cs.channel_id = c.channel_id) AS source_count
    FROM channels c
    ORDER BY c.name ASC
  `).all() as ChannelRow[]
  return rows.map(rowToChannel)
}

export function getChannelById(channelId: string, db?: Database.Database): Channel | null {
  const d = db ?? getDb()
  const row = d.prepare(`
    SELECT c.channel_id, c.name, c.category, c.last_seen_at,
           (SELECT COUNT(*) FROM channel_sources cs WHERE cs.channel_id = c.channel_id) AS source_count
    FROM channels c
    WHERE c.channel_id = ?
  `).get(channelId) as ChannelRow | undefined
  return row ? rowToChannel(row) : null
}

export function getChannelLinks(channelId: string, db?: Database.Database): ChannelSourceLink[] {
  const d = db ?? getDb()
  const rows = d.prepare('SELECT * FROM channel_sources WHERE channel_id = ?').all(channelId) as ChannelSourceLinkRow[]
  return rows.map(rowToLink)
}
