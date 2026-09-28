import type { ChannelCategory, ChannelListing } from '../types'
import { CHANNEL_ID_PREFIX } from '../types'

// ---------------------------------------------------------------------------
// canonicalChannel — turns a source's raw listing label into a stable
// cross-source channel identity, or null when the label isn't a channel at
// all (a game matchup, a nav link, junk).
//
// Every third-party source spells the same channel differently: "ESPN 2 HD",
// "ESPN2", "ESPN 2 (US)" all need to collapse to one row so the guide doesn't
// show three "ESPN 2"s with one source each. The approach:
//
//   1. Reject matchups and nav chrome outright (never channels).
//   2. Tokenize the label.
//   3. Recognize known MULTI-WORD names whole, before any word gets dropped
//      as a stopword — "USA Network" and "A&E" both contain a word ("usa",
//      "and") that's only noise in isolation, so this has to happen before
//      step 4 or dropping it would leave "Network" / "A E" behind.
//   4. Drop quality/region/live noise words from what's left.
//   5. Recognize known network abbreviations via a variant map.
//   6. Derive a display name (variant, an all-caps source token kept as-is,
//      or title-cased tokens otherwise) and a slug (alphanumeric-only,
//      lowercased) that doubles as the category lookup key and channel id.
//
// See docs/superpowers/specs/2026-09-28-live-channels-guide-design.md for the
// source rulings this encodes (channel-token retention, matchup regex
// precedence, etc).
// ---------------------------------------------------------------------------

/** Tokens dropped wherever they appear — quality tags, region tags, filler. */
const DROP_WORDS = new Set([
  'hd', 'fhd', 'uhd', '4k', 'sd',
  'usa', 'us', 'east', 'west', 'pacific',
  'live', 'stream',
  '24', '7', '247', 'hq',
  'tv-hd',
])

// Note: 'channel' is deliberately NOT in DROP_WORDS — "Golf Channel", "Tennis
// Channel" and "Disney Channel" need it to survive so their slugs match the
// category lists below (golfchannel, tennischannel, disneychannel).

/** Bare labels that are nav chrome, never a channel. */
const NAV_WORDS = new Set(['home', 'schedule', 'login', 'signup', 'menu', 'more', 'all', 'channels'])

/**
 * A label matching this is a game matchup ("Lakers vs Celtics", "Rams @
 * Broncos"). '@' isn't wrapped in \b — it's never a word character, so \b
 * only fires when it's glued to a letter/digit on both sides ("a@b"), not
 * when it's spaced out the way a matchup separator actually appears.
 */
const MATCHUP_VS = /\b(vs\.?|v\.?)\b|@/i
/** "at" also marks a matchup ("Rams at Broncos") — but not inside "AT&T". */
const MATCHUP_AT = /\bat\b/i
const AT_AND_T = /\bat\s*&\s*t\b/i

function isMatchup(label: string): boolean {
  if (MATCHUP_VS.test(label)) return true
  if (AT_AND_T.test(label)) return false // "AT&T SportsNet" is a channel, not "at" + something
  return MATCHUP_AT.test(label)
}

/**
 * Known network abbreviations/aliases, keyed by the space-joined, lowercased,
 * stopword-stripped tokens. Both spellings a source might use map to the same
 * canonical display name.
 */
const VARIANT_MAP: Record<string, string> = {
  'fox sports 1': 'FS1',
  'fs 1': 'FS1',
  'fox sports 2': 'FS2',
  'fs 2': 'FS2',
  'espn 2': 'ESPN2',
  'espn u': 'ESPNU',
  'espn news': 'ESPNews',
  'nbc sports network': 'NBCSN',
  'cbs sports network': 'CBS Sports Network',
  'cbssn': 'CBS Sports Network',
  'nfl redzone': 'NFL RedZone',
  'red zone': 'NFL RedZone',
  'big ten network': 'Big Ten Network',
  'btn': 'Big Ten Network',
  'sec network': 'SEC Network',
  'acc network': 'ACC Network',
}

const SPORTS_SLUGS = new Set([
  'espn', 'espnplus', 'espn2', 'espnu', 'espnews', 'fs1', 'fs2', 'nflnetwork', 'nflredzone',
  'mlbnetwork', 'nbatv', 'nhlnetwork', 'cbssportsnetwork', 'bigtennetwork',
  'secnetwork', 'accnetwork', 'golfchannel', 'tennischannel', 'beinsports',
  'nbcsn', 'tnt', 'tbs', 'trutv', 'usanetwork',
])

const NEWS_SLUGS = new Set([
  'cnn', 'foxnews', 'msnbc', 'cnbc', 'bbcnews', 'abcnewslive', 'cbsnews', 'newsmax', 'skynews',
])

const ENTERTAINMENT_SLUGS = new Set([
  'abc', 'cbs', 'nbc', 'fox', 'amc', 'hgtv', 'tlc', 'bravo', 'e', 'fx', 'fxx',
  'paramountnetwork', 'comedycentral', 'disneychannel', 'nickelodeon',
  'cartoonnetwork', 'history', 'discovery', 'foodnetwork', 'ae',
])

/** Suffixes a category set's slug might be missing relative to a fuller
 *  source spelling — "Fox News Channel" slugs to foxnewschannel, but only
 *  foxnews (NEWS_SLUGS' spelling) is a known category slug. Mirrors
 *  listings.ts's CHANNEL_ID_SUFFIXES, but this tolerance is applied only to
 *  the category lookup, never to the channel id itself: two sources
 *  spelling a channel differently still register under their own ids
 *  (foxnewschannel here, foxnews there) — resolveKnownChannelId in
 *  listings.ts is what later reconciles those into one row. */
const CATEGORY_SUFFIXES = ['channel', 'network', 'tv'] as const

function categoryForExact(slug: string): ChannelCategory | null {
  if (SPORTS_SLUGS.has(slug)) return 'sports'
  if (NEWS_SLUGS.has(slug)) return 'news'
  if (ENTERTAINMENT_SLUGS.has(slug)) return 'entertainment'
  return null
}

function categoryFor(slug: string): ChannelCategory {
  const direct = categoryForExact(slug)
  if (direct) return direct

  for (const suffix of CATEGORY_SUFFIXES) {
    if (!slug.endsWith(suffix) || slug.length === suffix.length) continue
    const stripped = categoryForExact(slug.slice(0, -suffix.length))
    if (stripped) return stripped
  }

  return 'other'
}

/** A raw label word paired with its cleaned (lowercased, punctuation-stripped) token. */
interface WordPair {
  raw: string
  clean: string
}

/** Strips everything but letters, digits and hyphens (hyphens are kept — "tv-hd" is one token).
 *  A "+" is a "plus" slug token, not punctuation to discard — "ESPN+" must slug to
 *  "espnplus", distinct from "espn", since ESPN+ is a different service from ESPN. */
function cleanWord(word: string): string {
  return word.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9-]/g, '')
}

/** Same "+" -> "plus" substitution as cleanWord, applied when slugging a
 *  whole display name (which may still carry punctuation cleanWord already
 *  stripped from individual tokens). */
function slugify(text: string): string {
  return text.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '')
}

/**
 * Canonical display names for channels whose slug is already known, keyed by
 * slug. A channel's display name must not depend on which source's label
 * happened to produce it last — one source might write "AE", another
 * "A&E USA"; both resolve to slug "ae" and must show the same name.
 */
const CANONICAL_NAMES: Record<string, string> = {
  ae: 'A&E',
}

function canonicalDisplayName(name: string, slug: string): string {
  return CANONICAL_NAMES[slug] ?? name
}

/** Title-cases a single cleaned token, e.g. 'sox' -> 'Sox'. */
function titleCase(token: string): string {
  return token.length === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1)
}

/**
 * A word that was all-uppercase in the source label — an abbreviation or
 * brand name to preserve as-is, regardless of length ("MSNBC", "ESPNU", not
 * just short ones like "CNN"). Punctuation around the letters/digits doesn't
 * count against it (only the letters/digits themselves need to be upper).
 */
function isSourceAllCaps(raw: string): boolean {
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, '')
  if (stripped.length < 2) return false
  if (!/[a-z]/i.test(stripped)) return false
  return stripped === stripped.toUpperCase()
}

/**
 * Known multi-word names that must be recognized whole, before the
 * drop-word pass — otherwise a word that's only a stopword in isolation
 * ("usa", "and") shreds a name where it's actually part of the brand
 * ("USA Network", "A&E" post-& -expansion is "A and E"). Matched as a
 * PREFIX against the label's cleaned tokens; anything after the known
 * name (a region/quality suffix, a repeated country tag) is discarded —
 * the known name fully determines the channel's identity.
 */
const KNOWN_MULTIWORD_NAMES: ReadonlyArray<{ tokens: readonly string[]; name: string }> = [
  { tokens: ['usa', 'network'], name: 'USA Network' },
  { tokens: ['a', 'and', 'e'], name: 'A&E' },
]

function matchKnownMultiwordName(pairs: readonly WordPair[]): string | null {
  for (const known of KNOWN_MULTIWORD_NAMES) {
    if (pairs.length < known.tokens.length) continue
    if (known.tokens.every((t, i) => pairs[i].clean === t)) return known.name
  }
  return null
}

/**
 * Handles a trailing "PREFIX (INNER)" shape ("AHC (American Heroes
 * Channel)", "CNN (Live)"). When PREFIX is really an abbreviation of INNER —
 * its letters match INNER's word initials — the parenthetical fully
 * determines the channel's identity, so the caller should recurse on INNER
 * alone. Otherwise the parenthetical is just a qualifier and gets dropped,
 * keeping PREFIX. Labels with no trailing parenthetical pass through
 * unchanged.
 */
function stripAbbreviationParenthetical(label: string): { recurseOn: string } | { keep: string } {
  const match = label.match(/^(.*?)\s*\(([^()]+)\)\s*$/)
  if (!match) return { keep: label }

  const [, prefix, inner] = match
  const abbr = prefix.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const acronym = inner
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  if (abbr.length >= 2 && abbr === acronym) return { recurseOn: inner.trim() }
  return { keep: prefix.trim() }
}

export function canonicalChannel(label: string): { channelId: string; name: string; category: ChannelCategory } | null {
  if (label.trim().length === 0) return null
  if (isMatchup(label)) return null

  const parenResult = stripAbbreviationParenthetical(label)
  if ('recurseOn' in parenResult) return canonicalChannel(parenResult.recurseOn)
  const workingLabel = parenResult.keep

  const expanded = workingLabel.replace(/&/g, ' and ')
  const rawWords = expanded.split(/\s+/).filter((w) => w.length > 0)

  const pairs: WordPair[] = rawWords
    .map((raw) => ({ raw, clean: cleanWord(raw) }))
    .filter((p) => p.clean.length > 0)

  if (pairs.length === 0) return null
  if (pairs.every((p) => NAV_WORDS.has(p.clean))) return null

  const knownName = matchKnownMultiwordName(pairs)
  if (knownName !== null) {
    const slug = slugify(knownName)
    if (slug.length === 0) return null
    return { channelId: `${CHANNEL_ID_PREFIX}${slug}`, name: canonicalDisplayName(knownName, slug), category: categoryFor(slug) }
  }

  const kept = pairs.filter((p) => !DROP_WORDS.has(p.clean))
  if (kept.length === 0) return null
  if (kept.length > 5) return null

  const joined = kept.map((p) => p.clean).join(' ')
  const variant = VARIANT_MAP[joined]

  const displayName = variant ?? kept.map((p) => (isSourceAllCaps(p.raw) ? p.raw.toUpperCase() : titleCase(p.clean))).join(' ')

  const slug = slugify(displayName)
  if (slug.length === 0) return null

  return { channelId: `${CHANNEL_ID_PREFIX}${slug}`, name: canonicalDisplayName(displayName, slug), category: categoryFor(slug) }
}

// ---------------------------------------------------------------------------
// pickChannelLinks — the pure link-picking step behind InterceptAdapter's
// listChannels(). Split out so it's testable without a real browser page (see
// task-2 rulings: no Playwright browser in the CI unit job) — tests feed it
// anchors captured once from each source's real listing page.
// ---------------------------------------------------------------------------

export function pickChannelLinks(
  anchors: { url: string; text: string }[],
  patterns: readonly RegExp[]
): ChannelListing[] {
  const seen = new Set<string>()
  const out: ChannelListing[] = []

  for (const anchor of anchors) {
    let pathname: string
    try {
      pathname = new URL(anchor.url).pathname
    } catch {
      continue
    }
    if (!patterns.some((p) => p.test(pathname))) continue

    const canon = canonicalChannel(anchor.text)
    if (!canon) continue
    if (seen.has(canon.channelId)) continue

    seen.add(canon.channelId)
    out.push({ label: anchor.text, url: anchor.url })
  }

  return out
}
