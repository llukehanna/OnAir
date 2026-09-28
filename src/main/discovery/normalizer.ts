import type { Game, GameStatus, LeagueId, TeamInfo } from '../types'

export interface EspnCompetitor {
  homeAway: 'home' | 'away'
  score?: string
  records?: Array<{ summary?: string }>
  team: {
    displayName: string
    abbreviation: string
    shortDisplayName?: string
    color?: string
    alternateColor?: string
    logo?: string
  }
}

export interface EspnEvent {
  id: string
  date: string
  competitions: Array<{
    competitors: EspnCompetitor[]
    status: { type: { name: string; shortDetail?: string } }
    broadcasts?: Array<{ names?: string[] }>
    venue?: { fullName?: string }
  }>
}

export function normalizeEvents(events: EspnEvent[], league: LeagueId): Game[] {
  return events
    .map(event => normalizeEvent(event, league))
    .filter((g): g is Game => g !== null)
}

function normalizeEvent(event: EspnEvent, league: LeagueId): Game | null {
  const competition = event.competitions[0]
  if (!competition) return null

  const home = competition.competitors.find(c => c.homeAway === 'home')
  const away = competition.competitors.find(c => c.homeAway === 'away')
  if (!home || !away) return null

  const startTime = Date.parse(event.date)
  const statusName = competition.status.type.name
  const status = mapStatus(statusName, startTime)
  if (status === null) return null

  const started = status !== 'SCHEDULED' && status !== 'STARTING_SOON'
  const game: Game = {
    gameId: `${league}_${event.id}`,
    league,
    teamHome: home.team.displayName,
    teamAway: away.team.displayName,
    startTime,
    status,
    away: toTeamInfo(away, started),
    home: toTeamInfo(home, started),
  }

  const statusDetail = competition.status.type.shortDetail
  if (statusDetail) game.statusDetail = statusDetail
  const network = competition.broadcasts?.[0]?.names?.[0]
  if (network) game.network = network
  const venue = competition.venue?.fullName
  if (venue) game.venue = venue

  return game
}

/** ESPN colors are 6-hex without '#'. Anything else is treated as absent. */
function hex(c: string | undefined): string | null {
  return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : null
}

function toTeamInfo(c: EspnCompetitor, started: boolean): TeamInfo {
  // ESPN reports "0" for games that haven't started; only trust scores once play begins.
  const score = started && c.score !== undefined && c.score !== '' ? Number(c.score) : null
  return {
    abbr: c.team.abbreviation,
    shortName: c.team.shortDisplayName ?? c.team.displayName,
    color: hex(c.team.color),
    altColor: hex(c.team.alternateColor),
    logo: c.team.logo ?? null,
    score: score !== null && Number.isFinite(score) ? score : null,
    record: c.records?.[0]?.summary ?? null,
  }
}

export function mapStatus(espnStatus: string, startTime: number): GameStatus | null {
  const now = Date.now()
  switch (espnStatus) {
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_HALFTIME':
    case 'STATUS_END_PERIOD':
      return 'LIVE'
    case 'STATUS_SCHEDULED':
      return (startTime - now < 60 * 60_000) ? 'STARTING_SOON' : 'SCHEDULED'
    case 'STATUS_FINAL':
      return (now - startTime < 3 * 60 * 60_000) ? 'RECENTLY_ENDED' : null
    default:
      return 'SCHEDULED'
  }
}
