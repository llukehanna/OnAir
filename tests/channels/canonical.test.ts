import { canonicalChannel, pickChannelLinks } from '../../src/main/channels/canonical'
import streamsports99Anchors from '../fixtures/channel-pages/streamsports99-ru.json'
import ntvStAnchors from '../fixtures/channel-pages/ntv-st.json'
import zliveStAnchors from '../fixtures/channel-pages/zlive-st.json'

// ---------------------------------------------------------------------------
// canonicalChannel
// ---------------------------------------------------------------------------

describe('canonicalChannel', () => {
  it('strips HD and applies the ESPN 2 variant', () => {
    const result = canonicalChannel('ESPN 2 HD')
    expect(result).toEqual({ channelId: 'ch:espn2', name: 'ESPN2', category: 'sports' })
  })

  it('strips USA and applies the Fox Sports 1 variant', () => {
    const result = canonicalChannel('Fox Sports 1 USA')
    expect(result?.name).toBe('FS1')
    expect(result?.channelId).toBe('ch:fs1')
    expect(result?.category).toBe('sports')
  })

  it('keeps TV as part of the name', () => {
    const result = canonicalChannel('NBA TV')
    expect(result).toEqual({ channelId: 'ch:nbatv', name: 'NBA TV', category: 'sports' })
  })

  it('strips Live and categorizes as news', () => {
    const result = canonicalChannel('CNN Live')
    expect(result?.name).toBe('CNN')
    expect(result?.category).toBe('news')
  })

  it('returns null for a matchup label with "vs"', () => {
    expect(canonicalChannel('Lakers vs Celtics')).toBeNull()
  })

  it('returns null for a matchup label with "@"', () => {
    expect(canonicalChannel('Lakers @ Celtics')).toBeNull()
  })

  it('returns null for a matchup label with "at"', () => {
    expect(canonicalChannel('Rams at Broncos')).toBeNull()
  })

  it('does not treat AT&T as a matchup', () => {
    const result = canonicalChannel('AT&T SportsNet')
    expect(result).not.toBeNull()
  })

  it('returns null for a bare navigation word', () => {
    expect(canonicalChannel('Home')).toBeNull()
  })

  it('returns null for the "all channels" navigation phrase', () => {
    expect(canonicalChannel('All Channels')).toBeNull()
  })

  it('strips East and categorizes HGTV as entertainment', () => {
    const result = canonicalChannel('HGTV East')
    expect(result?.name).toBe('HGTV')
    expect(result?.category).toBe('entertainment')
  })

  it('falls back to category other for an unrecognized local channel', () => {
    const result = canonicalChannel('Some Local 12')
    expect(result?.category).toBe('other')
  })

  it('keeps "Channel" in the name and categorizes sports channels named after it', () => {
    expect(canonicalChannel('Golf Channel')?.name).toBe('Golf Channel')
    expect(canonicalChannel('Golf Channel')?.category).toBe('sports')
    expect(canonicalChannel('Tennis Channel')?.category).toBe('sports')
  })

  it('categorizes Disney Channel as entertainment', () => {
    const result = canonicalChannel('Disney Channel')
    expect(result?.name).toBe('Disney Channel')
    expect(result?.category).toBe('entertainment')
  })

  it('canonicalizes the fixture adapter labels', () => {
    expect(canonicalChannel('Fixture One HD')).toEqual({
      channelId: 'ch:fixtureone',
      name: 'Fixture One',
      category: 'other',
    })
    expect(canonicalChannel('Fixture Two')).toEqual({
      channelId: 'ch:fixturetwo',
      name: 'Fixture Two',
      category: 'other',
    })
  })

  it('returns null for an empty label', () => {
    expect(canonicalChannel('')).toBeNull()
  })

  it('returns null once stopwords consume the entire label', () => {
    expect(canonicalChannel('Live HD USA')).toBeNull()
  })

  it('returns null for a label longer than 5 words', () => {
    expect(canonicalChannel('This Channel Has Way Too Many Words')).toBeNull()
  })

  it('applies the NBC Sports Network and CBS Sports Network variants', () => {
    expect(canonicalChannel('NBC Sports Network')?.name).toBe('NBCSN')
    expect(canonicalChannel('CBSSN')?.name).toBe('CBS Sports Network')
  })

  it('applies the NFL RedZone and Big Ten Network variants', () => {
    expect(canonicalChannel('NFL RedZone')?.name).toBe('NFL RedZone')
    expect(canonicalChannel('Red Zone')?.name).toBe('NFL RedZone')
    expect(canonicalChannel('BTN')?.name).toBe('Big Ten Network')
  })

  // -------------------------------------------------------------------------
  // Fix round 1: known multi-word names must be recognized BEFORE the
  // drop-word step, so "usa"/"and" don't shred them the way a bare stopword
  // pass would.
  // -------------------------------------------------------------------------

  it('keeps "USA Network" intact instead of dropping "usa" as a stopword', () => {
    const result = canonicalChannel('USA Network')
    expect(result).toEqual({ channelId: 'ch:usanetwork', name: 'USA Network', category: 'sports' })
  })

  it('keeps "USA Network" intact with trailing region/quality suffixes', () => {
    const result = canonicalChannel('USA Network East HD')
    expect(result?.name).toBe('USA Network')
    expect(result?.channelId).toBe('ch:usanetwork')
  })

  it('recognizes "A&E" instead of mangling it via the blind & -> and expansion', () => {
    const result = canonicalChannel('A&E')
    expect(result).toEqual({ channelId: 'ch:ae', name: 'A&E', category: 'entertainment' })
  })

  it('recognizes "A&E USA" as A&E, dropping the trailing country suffix', () => {
    const result = canonicalChannel('A&E USA')
    expect(result?.name).toBe('A&E')
    expect(result?.category).toBe('entertainment')
  })

  // -------------------------------------------------------------------------
  // Fix round 1: display casing — any all-uppercase source token (letters/
  // digits only, >=2 chars) keeps its uppercase, not just ones <=4 letters.
  // -------------------------------------------------------------------------

  it('keeps a 5+ letter all-caps source token uppercase (MSNBC)', () => {
    const result = canonicalChannel('MSNBC')
    expect(result?.name).toBe('MSNBC')
    expect(result?.category).toBe('news')
  })

  it('keeps a single-token all-caps label uppercase (ESPNU) via the variant map', () => {
    // ESPNU has no space, so it never hits the 'espn u' variant map entry —
    // it must survive as a bare all-caps token instead.
    const result = canonicalChannel('ESPNU')
    expect(result?.name).toBe('ESPNU')
    expect(result?.channelId).toBe('ch:espnu')
    expect(result?.category).toBe('sports')
  })

  it('still title-cases the fixture adapter labels (not all-caps in the source)', () => {
    expect(canonicalChannel('Fixture One HD')?.name).toBe('Fixture One')
  })

  // -------------------------------------------------------------------------
  // Category for suffixed labels: a slug that isn't itself in a category set
  // but IS once a trailing channel/network/tv suffix is stripped should still
  // resolve to that set's category — the id keeps the fuller spelling.
  // -------------------------------------------------------------------------

  it('categorizes "Fox News Channel" as news via suffix-tolerant category lookup', () => {
    const result = canonicalChannel('Fox News Channel')
    expect(result?.channelId).toBe('ch:foxnewschannel')
    expect(result?.name).toBe('Fox News Channel')
    expect(result?.category).toBe('news')
  })

  it('does not let suffix tolerance change the channel id itself', () => {
    // ch:foxnewschannel stays distinct from ch:foxnews; only the category
    // lookup tolerates the suffix, not identity.
    expect(canonicalChannel('Fox News Channel')?.channelId).not.toBe(canonicalChannel('Fox News')?.channelId)
  })
})

// ---------------------------------------------------------------------------
// pickChannelLinks
// ---------------------------------------------------------------------------

describe('pickChannelLinks', () => {
  const patterns = [/^\/live\//i]

  it('keeps anchors matching the pathname pattern with a non-null canonicalChannel', () => {
    const anchors = [
      { url: 'https://x.test/live/espn', text: 'ESPN' },
      { url: 'https://x.test/schedule', text: 'Schedule' }, // wrong pathname
      { url: 'https://x.test/live/lakers-vs-celtics', text: 'Lakers vs Celtics' }, // matchup -> null
    ]
    const result = pickChannelLinks(anchors, patterns)
    expect(result).toEqual([{ label: 'ESPN', url: 'https://x.test/live/espn' }])
  })

  it('de-duplicates by channelId, keeping the first occurrence', () => {
    const anchors = [
      { url: 'https://x.test/live/espn-hd', text: 'ESPN HD' },
      { url: 'https://x.test/live/espn-again', text: 'ESPN' },
    ]
    const result = pickChannelLinks(anchors, patterns)
    expect(result).toEqual([{ label: 'ESPN HD', url: 'https://x.test/live/espn-hd' }])
  })

  it('skips anchors with malformed URLs', () => {
    const anchors = [{ url: 'not a url', text: 'ESPN' }]
    expect(pickChannelLinks(anchors, patterns)).toEqual([])
  })

  it('returns [] when given no anchors', () => {
    expect(pickChannelLinks([], patterns)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// pickChannelLinks against real captured anchors
//
// Each fixture is a trimmed sample of a[href] anchors actually captured from
// the source's rendered channel-listing page (see task-2-report.md for how
// and when). Patterns mirror each source's configured channels.linkPatterns
// so this doubles as a regression test for those configs.
// ---------------------------------------------------------------------------

describe('pickChannelLinks against captured source anchors', () => {
  it('finds at least 20 known channels on streamsports99.ru/live-tv, restricted to the US group', () => {
    const patterns = [/^\/live-tv\/.+__us$/i]
    const result = pickChannelLinks(streamsports99Anchors, patterns)
    expect(result.length).toBeGreaterThanOrEqual(20)
    const ids = result.map((c) => canonicalChannel(c.label)?.channelId)
    expect(ids).toEqual(expect.arrayContaining(['ch:espn2', 'ch:cnn', 'ch:accnetwork', 'ch:disneychannel']))
  })

  it('excludes a non-US duplicate of a channel (I3: __uk is not __us)', () => {
    const patterns = [/^\/live-tv\/.+__us$/i]
    const result = pickChannelLinks(streamsports99Anchors, patterns)
    expect(result.some((c) => c.url.endsWith('__uk'))).toBe(false)
    expect(result.some((c) => c.label === 'ESPN' && c.url.includes('__uk'))).toBe(false)
  })

  it('finds at least 10 known channels on ntv.st/channels', () => {
    const patterns = [/^\/channel\/[a-z]+\//i]
    const result = pickChannelLinks(ntvStAnchors, patterns)
    expect(result.length).toBeGreaterThanOrEqual(10)
    const ids = result.map((c) => canonicalChannel(c.label)?.channelId)
    expect(ids).toEqual(expect.arrayContaining(['ch:abc', 'ch:cnn', 'ch:accnetwork', 'ch:bbc']))
  })

  it('finds at least 10 known channels on zlive.st', () => {
    const patterns = [/^\/watch\//i]
    const result = pickChannelLinks(zliveStAnchors, patterns)
    expect(result.length).toBeGreaterThanOrEqual(10)
    const ids = result.map((c) => canonicalChannel(c.label)?.channelId)
    expect(ids).toEqual(expect.arrayContaining(['ch:bigtennetwork', 'ch:cbssportsnetwork', 'ch:accnetwork']))
  })

  it('excludes nav noise present in the same fixtures', () => {
    const patterns = [/^\/live-tv\/.+__[a-z]{2}$/i]
    const result = pickChannelLinks(streamsports99Anchors, patterns)
    expect(result.some((c) => c.label === 'Schedule' || c.label === 'Sign In')).toBe(false)
  })
})
