import type { Channel, Game, GuideData, GuideProgram, LeagueId } from '../types'
import { canonicalChannel } from './canonical'

// ---------------------------------------------------------------------------
// Guide listings — turns ESPN games and TVmaze's US schedule into the
// GuideProgram rows a channel's guide row shows, then merges the two into
// one GuideData.
//
// Two independent sources feed the guide:
//   - games (already in the DB via discovery/scheduler.ts): each carries a
//     `network` string ESPN reports (e.g. 'NBC', 'ESPN', 'NBCSN').
//   - TVmaze's public schedule endpoint: no API key, but also no live-sports
//     coverage worth relying on — it's here for the regular-programming rows
//     that fill a channel's guide around/between games.
//
// Both sides funnel through canonicalChannel so "NBC" (game.network) and
// "NBC" (TVmaze show.network.name) land on the exact same channel row.
// ---------------------------------------------------------------------------

/** Approximate broadcast length per league, used to give a game program an end time. */
export const GAME_MINUTES: Record<LeagueId, number> = {
  nfl: 195,
  cfb: 210,
  mlb: 180,
  nba: 150,
  cbb: 120,
}

const DEFAULT_SHOW_MINUTES = 60
const TVMAZE_TIMEOUT_MS = 5000
const GUIDE_LOOKBACK_MS = 60 * 60_000 // 1h
const GUIDE_LOOKAHEAD_MS = 24 * 60 * 60_000 // 24h

/** The subset of TVmaze's schedule episode shape the guide actually reads. */
export interface TvmazeEpisode {
  airstamp: string
  runtime: number | null
  name: string
  show: {
    name: string
    network?: { name: string } | null
    webChannel?: { name: string } | null
  }
}

/**
 * Games whose network maps to a known channel become 'game' programs. A
 * game with no network, or one canonicalChannel can't place (a regional
 * label it doesn't recognize), is dropped — the guide has nowhere to put it.
 */
export function gamePrograms(games: Game[]): GuideProgram[] {
  const out: GuideProgram[] = []

  for (const game of games) {
    if (!game.network) continue
    const canon = canonicalChannel(game.network)
    if (!canon) continue

    const awayName = game.away?.shortName ?? game.teamAway
    const homeName = game.home?.shortName ?? game.teamHome
    const minutes = GAME_MINUTES[game.league]

    out.push({
      channelId: canon.channelId,
      title: `${awayName} at ${homeName}`,
      subtitle: game.headline ?? game.statusDetail,
      start: game.startTime,
      end: game.startTime + minutes * 60_000,
      kind: 'game',
      gameId: game.gameId,
    })
  }

  return out
}

/**
 * TVmaze episodes whose network (or, absent that, webChannel) maps to a
 * known channel become 'show' programs. A null runtime — TVmaze doesn't
 * always know one — defaults to an hour.
 */
export function tvmazePrograms(episodes: TvmazeEpisode[]): GuideProgram[] {
  const out: GuideProgram[] = []

  for (const episode of episodes) {
    const networkName = episode.show.network?.name ?? episode.show.webChannel?.name
    if (!networkName) continue
    const canon = canonicalChannel(networkName)
    if (!canon) continue

    const start = new Date(episode.airstamp).getTime()
    if (Number.isNaN(start)) continue

    const minutes = episode.runtime ?? DEFAULT_SHOW_MINUTES
    const title = episode.show.name
    const subtitle = episode.name && episode.name !== title ? episode.name : undefined

    out.push({
      channelId: canon.channelId,
      title,
      subtitle,
      start,
      end: start + minutes * 60_000,
      kind: 'show',
    })
  }

  return out
}

function overlaps(a: GuideProgram, b: GuideProgram): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Slug suffixes a source might append (or a source might omit) relative to
 * another source's spelling of the same channel — e.g. TVmaze's "Fox News
 * Channel" (ch:foxnewschannel) vs. a scraped source's "Fox News"
 * (ch:foxnews); TVmaze's "Fox Business" (ch:foxbusiness, hypothetically) vs.
 * a source's "Fox Business Network" (ch:foxbusinessnetwork). canonicalChannel
 * has no way to know which spelling is "the" channel — it just canonicalizes
 * whatever label it's given — so a genuinely different id from the one a
 * source actually registered under is a real, if narrow, class of mismatch.
 */
const CHANNEL_ID_SUFFIXES = ['channel', 'network', 'tv'] as const

/**
 * Resolves `id` against the set of known channel ids, tolerating one of the
 * suffixes above being present on one side and not the other:
 *   1. Exact match wins outright.
 *   2. `id` with a trailing suffix stripped, if THAT'S known.
 *   3. `id` with a trailing suffix added, if THAT'S known.
 * Returns null when none of the above land — callers treat that exactly as
 * they would an id that was never resolved at all.
 */
export function resolveKnownChannelId(id: string, knownIds: Set<string>): string | null {
  if (knownIds.has(id)) return id

  for (const suffix of CHANNEL_ID_SUFFIXES) {
    if (id.endsWith(suffix)) {
      const stripped = id.slice(0, -suffix.length)
      if (stripped.length > 0 && knownIds.has(stripped)) return stripped
    }
  }

  for (const suffix of CHANNEL_ID_SUFFIXES) {
    const withSuffix = `${id}${suffix}`
    if (knownIds.has(withSuffix)) return withSuffix
  }

  return null
}

/**
 * Rewrites each program's channelId to its resolved known id, when
 * resolveKnownChannelId finds one — otherwise leaves it as-is (so an
 * unresolved id still simply fails the known-channel filter downstream,
 * same as before this existed). Applied to games and shows separately,
 * before mergePrograms, so the same-channel overlap rule in mergePrograms
 * compares resolved ids rather than two spellings of the same channel.
 */
function resolveProgramChannels(programs: GuideProgram[], knownIds: Set<string>): GuideProgram[] {
  return programs.map((program) => {
    const resolved = resolveKnownChannelId(program.channelId, knownIds)
    return resolved ? { ...program, channelId: resolved } : program
  })
}

/**
 * Programs sharing the same (channelId, start, title) are the same
 * broadcast reported twice — e.g. two TVmaze network-name spellings that
 * both resolve, via resolveProgramChannels, to the same known channel.
 * Without this, the guide (and the renderer, which keys rows on exactly
 * this triple) shows the same program twice on one channel. Keeps the
 * first occurrence.
 */
function dedupePrograms(programs: GuideProgram[]): GuideProgram[] {
  const seen = new Set<string>()
  const out: GuideProgram[] = []

  for (const program of programs) {
    const key = `${program.channelId}\u0000${program.start}\u0000${program.title}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(program)
  }

  return out
}

/**
 * Combines games and shows into one guide: a show overlapping a game on the
 * SAME channel loses — the game is what's actually airing — while a show on
 * another channel, or one that doesn't overlap, survives. Sorted by channel
 * id then start time so a channel's row reads left to right in order, then
 * de-duplicated by (channelId, start, title) — see dedupePrograms.
 */
export function mergePrograms(games: GuideProgram[], shows: GuideProgram[]): GuideProgram[] {
  const keptShows = shows.filter(
    (show) => !games.some((game) => game.channelId === show.channelId && overlaps(game, show))
  )

  const combined = [...games, ...keptShows].sort((a, b) => {
    if (a.channelId !== b.channelId) return a.channelId < b.channelId ? -1 : 1
    return a.start - b.start
  })

  return dedupePrograms(combined)
}

/** Local YYYY-MM-DD for a date — TVmaze's `date` param is calendar-day, not UTC. */
function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface TvmazeDateResult {
  ok: boolean
  episodes: TvmazeEpisode[]
}

/** One date's request against TVmaze — success/failure kept distinct from
 *  the flattened [] the public fetchers return, since the cache below needs
 *  to tell "really no shows that day" apart from "the request failed". */
async function fetchTvmazeForDate(date: string, fetchFn: typeof fetch): Promise<TvmazeDateResult> {
  try {
    const response = await fetchFn(`https://api.tvmaze.com/schedule?country=US&date=${date}`, {
      signal: AbortSignal.timeout(TVMAZE_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, episodes: [] }
    const json = (await response.json()) as unknown
    return { ok: true, episodes: Array.isArray(json) ? (json as TvmazeEpisode[]) : [] }
  } catch {
    return { ok: false, episodes: [] }
  }
}

/** Shape shared by fetchTvmaze and fetchTvmazeCached, so buildGuide can take
 *  either as its fetchTvmazeFn override. */
export type TvmazeFetcher = (dates: string[], fetchFn?: typeof fetch, now?: number) => Promise<TvmazeEpisode[]>

/**
 * Fetches TVmaze's US schedule for each date, 5s timeout apiece. A single
 * date's request failing (network error, timeout, non-2xx) yields [] for
 * that date only — it never throws, and never costs the other dates theirs.
 * Always hits the network; see fetchTvmazeCached for the cached variant
 * production wiring actually uses. `now` is accepted (unused) only so this
 * has the same call shape as fetchTvmazeCached — see TvmazeFetcher.
 */
export const fetchTvmaze: TvmazeFetcher = async (dates, fetchFn = fetch) => {
  const perDate = await Promise.all(dates.map((date) => fetchTvmazeForDate(date, fetchFn)))
  return perDate.flatMap((r) => r.episodes)
}

const TVMAZE_CACHE_TTL_MS = 30 * 60_000

interface TvmazeCacheEntry {
  episodes: TvmazeEpisode[]
  fetchedAt: number
}

/** One entry per date ('2026-09-28' etc.), so "today" and "tomorrow" expire independently. */
const tvmazeCache = new Map<string, TvmazeCacheEntry>()

/**
 * Same contract as fetchTvmaze, but a date whose last successful fetch is
 * still within the 30-minute TTL is served from cache instead of hitting
 * TVmaze again. Without this, every games-updated, channels-updated, and the
 * 30-minute guide timer — which can all fire within moments of each other —
 * would each re-fetch TVmaze from scratch, when only the games/channels side
 * of the guide actually needs re-merging most of the time.
 *
 * A failed fetch (network error, timeout, non-2xx) is deliberately never
 * cached as if it were a real "no shows today" — the next caller retries it
 * rather than the guide going quietly show-less for the rest of the TTL
 * window over one transient failure.
 */
export const fetchTvmazeCached: TvmazeFetcher = async (dates, fetchFn = fetch, now = Date.now()) => {
  // Bound the cache to the rolling window actually in use — buildGuide only
  // ever asks for [today, tomorrow], so once a date falls out of that window
  // (yesterday's "today") it's never going to be requested again and should
  // be evicted, not held onto for the life of the process.
  const requestedDates = new Set(dates)
  for (const cachedDate of tvmazeCache.keys()) {
    if (!requestedDates.has(cachedDate)) tvmazeCache.delete(cachedDate)
  }

  const results = await Promise.all(
    dates.map(async (date): Promise<TvmazeEpisode[]> => {
      const cached = tvmazeCache.get(date)
      if (cached && now - cached.fetchedAt < TVMAZE_CACHE_TTL_MS) return cached.episodes

      const result = await fetchTvmazeForDate(date, fetchFn)
      if (result.ok) tvmazeCache.set(date, { episodes: result.episodes, fetchedAt: now })
      return result.episodes
    })
  )
  return results.flat()
}

/** Test-only: clears the module-level TVmaze cache between cases. */
export function __resetTvmazeCacheForTests(): void {
  tvmazeCache.clear()
}

/**
 * Builds the full guide: games (from the DB) merged with TVmaze's US
 * schedule for today and tomorrow (local date), restricted to known channels
 * and to a [now-1h, now+24h] window — recent enough that a still-running
 * program isn't cut off, far enough ahead to be useful.
 */
export async function buildGuide(deps: {
  channels: Channel[]
  games: Game[]
  fetchFn?: typeof fetch
  now?: number
  /** Defaults to the uncached fetchTvmaze, which is what every existing
   *  test exercises. Production wiring (buildAndStoreGuide below) passes
   *  fetchTvmazeCached instead. */
  fetchTvmazeFn?: TvmazeFetcher
}): Promise<GuideData> {
  const now = deps.now ?? Date.now()
  const today = new Date(now)
  const tomorrow = new Date(now + GUIDE_LOOKAHEAD_MS)
  const dates = [localDateString(today), localDateString(tomorrow)]

  const fetchTvmazeFn = deps.fetchTvmazeFn ?? fetchTvmaze
  const episodes = await fetchTvmazeFn(dates, deps.fetchFn, now)

  const knownChannelIds = new Set(deps.channels.map((c) => c.channelId))

  const games = resolveProgramChannels(gamePrograms(deps.games), knownChannelIds)
  const shows = resolveProgramChannels(tvmazePrograms(episodes), knownChannelIds)
  const merged = mergePrograms(games, shows)

  const windowStart = now - GUIDE_LOOKBACK_MS
  const windowEnd = now + GUIDE_LOOKAHEAD_MS

  const programs = merged.filter(
    (p) => knownChannelIds.has(p.channelId) && p.end > windowStart && p.start < windowEnd
  )

  return { channels: deps.channels, programs, generatedAt: now }
}

// ---------------------------------------------------------------------------
// Shared "latest guide" store — the one place index.ts and ipc/handlers.ts
// both go through, so they can't independently call buildGuide({channels,
// games}) and race each other (I2). index.ts's refresh loop is the only
// thing that proactively rebuilds; the 'get-guide' IPC handler just serves
// whatever that loop last produced, building once itself only if nothing
// has been built yet (e.g. a renderer asking before startup's first pass
// completes).
// ---------------------------------------------------------------------------

let latestGuide: GuideData | null = null

/** The most recently built guide, or null before the first one. */
export function getLatestGuide(): GuideData | null {
  return latestGuide
}

/** Builds a guide via the cached TVmaze fetch and records it as the latest. */
export async function buildAndStoreGuide(deps: {
  channels: Channel[]
  games: Game[]
  fetchFn?: typeof fetch
  now?: number
}): Promise<GuideData> {
  const guide = await buildGuide({ ...deps, fetchTvmazeFn: fetchTvmazeCached })
  latestGuide = guide
  return guide
}

/** Returns the latest built guide, building (and storing) one now if none exists yet. */
export async function getOrBuildGuide(deps: {
  channels: Channel[]
  games: Game[]
  fetchFn?: typeof fetch
  now?: number
}): Promise<GuideData> {
  return latestGuide ?? buildAndStoreGuide(deps)
}

/** Test-only: clears the stored latest guide. */
export function __resetLatestGuideForTests(): void {
  latestGuide = null
}
