import type { LeagueId } from '../types'
import type { EspnEvent } from './normalizer'

export const ESPN_ENDPOINTS: Record<LeagueId, string> = {
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  cbb: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  cfb: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
}

export async function fetchLeague(league: LeagueId): Promise<EspnEvent[]> {
  const url = ESPN_ENDPOINTS[league]
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { 'Accept': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`ESPN ${league} returned HTTP ${response.status}`)
  }
  const json = await response.json() as { events?: EspnEvent[] }
  return json.events ?? []
}

export type { EspnEvent }
