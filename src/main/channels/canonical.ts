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
//   2. Tokenize the label, dropping quality/region/live noise words.
//   3. Recognize known network abbreviations via a variant map.
//   4. Derive a display name (variant, or title-cased tokens) and a slug
//      (alphanumeric-only, lowercased) that doubles as the category lookup
//      key and the channel id.
//
// See docs/PLANNING/2026-09-28-live-channels-guide for the source rulings
// this encodes (channel-token retention, matchup regex precedence, etc).
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
  'espn', 'espn2', 'espnu', 'espnews', 'fs1', 'fs2', 'nflnetwork', 'nflredzone',
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
  'cartoonnetwork', 'history', 'discovery', 'foodnetwork',
])

function categoryFor(slug: string): ChannelCategory {
  if (SPORTS_SLUGS.has(slug)) return 'sports'
  if (NEWS_SLUGS.has(slug)) return 'news'
  if (ENTERTAINMENT_SLUGS.has(slug)) return 'entertainment'
  return 'other'
}

/** A raw label word paired with its cleaned (lowercased, punctuation-stripped) token. */
interface WordPair {
  raw: string
  clean: string
}

/** Strips everything but letters, digits and hyphens (hyphens are kept — "tv-hd" is one token). */
function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** Title-cases a single cleaned token, e.g. 'sox' -> 'Sox'. */
function titleCase(token: string): string {
  return token.length === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1)
}

/** A short (<=4 char) word that was all-uppercase in the source label — an abbreviation to preserve as-is. */
function isSourceAbbreviation(raw: string): boolean {
  return raw.length <= 4 && /[a-z]/i.test(raw) && raw === raw.toUpperCase()
}

export function canonicalChannel(label: string): { channelId: string; name: string; category: ChannelCategory } | null {
  if (label.trim().length === 0) return null
  if (isMatchup(label)) return null

  const expanded = label.replace(/&/g, ' and ')
  const rawWords = expanded.split(/\s+/).filter((w) => w.length > 0)

  const pairs: WordPair[] = rawWords
    .map((raw) => ({ raw, clean: cleanWord(raw) }))
    .filter((p) => p.clean.length > 0)

  if (pairs.length === 0) return null
  if (pairs.every((p) => NAV_WORDS.has(p.clean))) return null

  const kept = pairs.filter((p) => !DROP_WORDS.has(p.clean))
  if (kept.length === 0) return null
  if (kept.length > 5) return null

  const joined = kept.map((p) => p.clean).join(' ')
  const variant = VARIANT_MAP[joined]

  const displayName = variant ?? kept.map((p) => (isSourceAbbreviation(p.raw) ? p.raw.toUpperCase() : titleCase(p.clean))).join(' ')

  const slug = displayName.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (slug.length === 0) return null

  return { channelId: `${CHANNEL_ID_PREFIX}${slug}`, name: displayName, category: categoryFor(slug) }
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
