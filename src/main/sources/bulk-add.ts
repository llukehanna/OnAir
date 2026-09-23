import Database from 'better-sqlite3'
import { getDb } from '../db/connection'
import { addSource, getSources } from '../db/queries/sources'

// ---------------------------------------------------------------------------
// Bulk source entry
//
// The operator supplies the source list; this module only parses, normalizes,
// and stores what it is given. Nothing here discovers or fetches sources.
//
// Input is expected to be pasted by hand and therefore messy: bare hostnames,
// mixed schemes, trailing paths, mirrors of the same host, and blank lines.
// Every line is either accepted, reported as a duplicate, or reported as
// invalid — a bad line never aborts the batch.
// ---------------------------------------------------------------------------

export interface ParsedSourceInput {
  /** Fully-qualified URL, scheme included. */
  url: string
  /** Lowercased hostname, used as the identity key for deduplication. */
  hostname: string
  /** Slug derived from the hostname. */
  sourceId: string
  /** Display name. */
  name: string
}

export interface BulkAddResult {
  /** sourceIds inserted. */
  added: string[]
  /** Hostnames skipped because the host is already known. */
  duplicates: string[]
  /** Raw lines that could not be parsed. */
  invalid: string[]
}

/** Defaults applied to a hand-entered source. */
const MANUAL_SOURCE_DEFAULTS = {
  classification: 'mixed_aggregator',
  /**
   * Empty on purpose. getEnabledSourcesForLeague() matches on this list, so an
   * empty list keeps a new source inert until an adapter declares its coverage.
   * A newly pasted host has no adapter, so it must not enter candidate
   * collection and consume pool slots for nothing.
   */
  supportedLeagues: [] as [],
  extractionMethod: 'network_intercept',
  confidenceWeight: 0.5,
  healthState: 'unknown',
  healthUpdatedAt: null,
  enabled: true,
  needsAdapter: true,
} as const

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

/**
 * Converts a hostname into a stable slug id.
 *
 * The TLD is retained rather than stripped, because sibling TLDs are commonly
 * distinct mirrors of the same site (example.com and example.net) and must not
 * collapse into one id.
 */
export function hostnameToSourceId(hostname: string): string {
  return stripWww(hostname.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Parses pasted text into normalized source entries.
 *
 * One entry per line. A line without a scheme is assumed to be https. Paths are
 * preserved, since some sources are only reachable at a subpath. Entries are
 * deduplicated by hostname with the first occurrence winning.
 */
export function parseSourceList(text: string): { entries: ParsedSourceInput[]; invalid: string[] } {
  const entries: ParsedSourceInput[] = []
  const invalid: string[] = []
  const seenHostnames = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue

    const withScheme = /^https?:\/\//i.test(line) ? line : `https://${line}`

    let parsed: URL
    try {
      parsed = new URL(withScheme)
    } catch {
      invalid.push(line)
      continue
    }

    // A hostname with no dot (or with whitespace) is a typo, not a host.
    const hostname = parsed.hostname.toLowerCase()
    if (!hostname.includes('.') || /\s/.test(hostname)) {
      invalid.push(line)
      continue
    }

    const key = stripWww(hostname)
    if (seenHostnames.has(key)) continue
    seenHostnames.add(key)

    entries.push({
      url: parsed.href,
      hostname,
      sourceId: hostnameToSourceId(hostname),
      name: key,
    })
  }

  return { entries, invalid }
}

/**
 * Parses pasted text and inserts any hosts not already in the sources table.
 *
 * Existing rows are never modified — a host already present is reported as a
 * duplicate and left untouched, so re-pasting a list cannot clobber source
 * rows that have since been edited or had an adapter attached.
 */
export function addSourcesBulk(text: string, db?: Database.Database): BulkAddResult {
  const d = db ?? getDb()
  const { entries, invalid } = parseSourceList(text)

  const knownHostnames = new Set<string>()
  for (const source of getSources(d)) {
    try {
      knownHostnames.add(stripWww(new URL(source.baseUrl).hostname.toLowerCase()))
    } catch {
      // A malformed stored base_url cannot participate in deduplication.
    }
  }

  const added: string[] = []
  const duplicates: string[] = []

  for (const entry of entries) {
    const key = stripWww(entry.hostname)
    if (knownHostnames.has(key)) {
      duplicates.push(entry.hostname)
      continue
    }

    addSource(
      {
        ...MANUAL_SOURCE_DEFAULTS,
        sourceId: entry.sourceId,
        name: entry.name,
        baseUrl: entry.url,
        addedAt: Date.now(),
      },
      d
    )

    knownHostnames.add(key)
    added.push(entry.sourceId)
  }

  return { added, duplicates, invalid }
}
