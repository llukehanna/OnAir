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
 * Combines games and shows into one guide: a show overlapping a game on the
 * SAME channel loses — the game is what's actually airing — while a show on
 * another channel, or one that doesn't overlap, survives. Sorted by channel
 * id then start time so a channel's row reads left to right in order.
 */
export function mergePrograms(games: GuideProgram[], shows: GuideProgram[]): GuideProgram[] {
  const keptShows = shows.filter(
    (show) => !games.some((game) => game.channelId === show.channelId && overlaps(game, show))
  )

  return [...games, ...keptShows].sort((a, b) => {
    if (a.channelId !== b.channelId) return a.channelId < b.channelId ? -1 : 1
    return a.start - b.start
  })
}

/** Local YYYY-MM-DD for a date — TVmaze's `date` param is calendar-day, not UTC. */
function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Fetches TVmaze's US schedule for each date, 5s timeout apiece. A single
 * date's request failing (network error, timeout, non-2xx) yields [] for
 * that date only — it never throws, and never costs the other dates theirs.
 */
export async function fetchTvmaze(dates: string[], fetchFn: typeof fetch = fetch): Promise<TvmazeEpisode[]> {
  const perDate = await Promise.all(
    dates.map(async (date): Promise<TvmazeEpisode[]> => {
      try {
        const response = await fetchFn(`https://api.tvmaze.com/schedule?country=US&date=${date}`, {
          signal: AbortSignal.timeout(TVMAZE_TIMEOUT_MS),
        })
        if (!response.ok) return []
        const json = (await response.json()) as unknown
        return Array.isArray(json) ? (json as TvmazeEpisode[]) : []
      } catch {
        return []
      }
    })
  )

  return perDate.flat()
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
}): Promise<GuideData> {
  const now = deps.now ?? Date.now()
  const today = new Date(now)
  const tomorrow = new Date(now + GUIDE_LOOKAHEAD_MS)
  const dates = [localDateString(today), localDateString(tomorrow)]

  const episodes = await fetchTvmaze(dates, deps.fetchFn)

  const games = gamePrograms(deps.games)
  const shows = tvmazePrograms(episodes)
  const merged = mergePrograms(games, shows)

  const knownChannelIds = new Set(deps.channels.map((c) => c.channelId))
  const windowStart = now - GUIDE_LOOKBACK_MS
  const windowEnd = now + GUIDE_LOOKAHEAD_MS

  const programs = merged.filter(
    (p) => knownChannelIds.has(p.channelId) && p.end > windowStart && p.start < windowEnd
  )

  return { channels: deps.channels, programs, generatedAt: now }
}
