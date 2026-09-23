import { parseSourceList, hostnameToSourceId, addSourcesBulk } from '../../src/main/sources/bulk-add'
import { createTestDbWithMigrations } from '../helpers/db'
import { getSources } from '../../src/main/db/queries/sources'
import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// hostnameToSourceId
// ---------------------------------------------------------------------------

describe('hostnameToSourceId', () => {
  it('converts a hostname to a slug', () => {
    expect(hostnameToSourceId('streams.example.net')).toBe('streams-example-net')
  })

  it('strips a www. prefix', () => {
    expect(hostnameToSourceId('www.streams.example')).toBe('streams-example')
  })

  it('keeps sibling TLDs distinct so mirrors do not collide', () => {
    expect(hostnameToSourceId('mirror.example.com')).not.toBe(hostnameToSourceId('mirror.example.net'))
  })

  it('collapses runs of non-alphanumeric characters', () => {
    expect(hostnameToSourceId('v2.go--stream.link')).toBe('v2-go-stream-link')
  })
})

// ---------------------------------------------------------------------------
// parseSourceList
// ---------------------------------------------------------------------------

describe('parseSourceList', () => {
  it('parses one URL per line', () => {
    const { entries, invalid } = parseSourceList('https://a.example/\nhttps://b.example/')
    expect(entries.map((e) => e.hostname)).toEqual(['a.example', 'b.example'])
    expect(invalid).toEqual([])
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const { entries } = parseSourceList('\n\n   https://a.example/   \n\n')
    expect(entries).toHaveLength(1)
    expect(entries[0].hostname).toBe('a.example')
  })

  it('accepts a bare hostname and assumes https', () => {
    const { entries } = parseSourceList('a.example')
    expect(entries[0].url).toBe('https://a.example/')
  })

  it('preserves a meaningful path', () => {
    const { entries } = parseSourceList('https://livetv.example/enx/')
    expect(entries[0].url).toBe('https://livetv.example/enx/')
  })

  it('preserves an explicit http scheme rather than upgrading it', () => {
    const { entries } = parseSourceList('http://ntv.example/')
    expect(entries[0].url).toBe('http://ntv.example/')
  })

  it('lowercases the hostname', () => {
    const { entries } = parseSourceList('https://A.EXAMPLE/')
    expect(entries[0].hostname).toBe('a.example')
  })

  it('deduplicates repeated hostnames, keeping the first occurrence', () => {
    const { entries } = parseSourceList('https://a.example/one\nhttps://a.example/two')
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe('https://a.example/one')
  })

  it('treats different hostnames as separate entries even when related', () => {
    const { entries } = parseSourceList('https://mirror.example.com/\nhttps://mirror.example.net/')
    expect(entries).toHaveLength(2)
  })

  it('reports unparseable lines as invalid rather than throwing', () => {
    const { entries, invalid } = parseSourceList('https://good.example/\nnot a url at all\n:::')
    expect(entries).toHaveLength(1)
    expect(invalid).toEqual(['not a url at all', ':::'])
  })

  it('returns empty results for empty input', () => {
    expect(parseSourceList('')).toEqual({ entries: [], invalid: [] })
  })
})

// ---------------------------------------------------------------------------
// addSourcesBulk
// ---------------------------------------------------------------------------

describe('addSourcesBulk', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDbWithMigrations()
  })

  afterEach(() => {
    db.close()
  })

  it('inserts new sources and reports their ids', () => {
    const result = addSourcesBulk('https://brand-new-a.example/\nhttps://brand-new-b.example/', db)
    expect(result.added).toEqual(['brand-new-a-example', 'brand-new-b-example'])
    expect(result.duplicates).toEqual([])
    expect(result.invalid).toEqual([])
  })

  it('persists a source that can be read back', () => {
    addSourcesBulk('https://brand-new-a.example/', db)
    const added = getSources(db).find((s) => s.sourceId === 'brand-new-a-example')
    expect(added).toBeDefined()
    expect(added?.baseUrl).toBe('https://brand-new-a.example/')
  })

  it('marks a manually added source as needing an adapter', () => {
    addSourcesBulk('https://brand-new-a.example/', db)
    const added = getSources(db).find((s) => s.sourceId === 'brand-new-a-example')
    expect(added?.needsAdapter).toBe(true)
    expect(added?.healthState).toBe('unknown')
  })

  it('leaves supportedLeagues empty so the source stays inert until an adapter declares coverage', () => {
    addSourcesBulk('https://brand-new-a.example/', db)
    const added = getSources(db).find((s) => s.sourceId === 'brand-new-a-example')
    expect(added?.supportedLeagues).toEqual([])
  })

  it('skips a hostname already present in the table', () => {
    addSourcesBulk('https://brand-new-a.example/', db)
    const result = addSourcesBulk('https://brand-new-a.example/different-path', db)
    expect(result.added).toEqual([])
    expect(result.duplicates).toEqual(['brand-new-a.example'])
  })

  it('does not overwrite an existing source row', () => {
    addSourcesBulk('https://brand-new-a.example/original', db)
    addSourcesBulk('https://brand-new-a.example/replacement', db)
    const added = getSources(db).find((s) => s.sourceId === 'brand-new-a-example')
    expect(added?.baseUrl).toBe('https://brand-new-a.example/original')
  })

  it('skips sources that already exist rather than duplicating them', () => {
    addSourcesBulk('https://existing.example/', db)
    const existing = getSources(db).find((s) => s.sourceId === 'existing-example')!
    const result = addSourcesBulk(existing.baseUrl, db)
    expect(result.added).toEqual([])
    expect(result.duplicates).toHaveLength(1)
  })

  it('adds the valid entries even when some lines are invalid', () => {
    const result = addSourcesBulk('https://brand-new-a.example/\ngarbage line', db)
    expect(result.added).toEqual(['brand-new-a-example'])
    expect(result.invalid).toEqual(['garbage line'])
  })

  it('is a no-op for empty input', () => {
    const before = getSources(db).length
    const result = addSourcesBulk('   \n  \n', db)
    expect(result.added).toEqual([])
    expect(getSources(db)).toHaveLength(before)
  })
})
