import type { Game, GameStatus, LeagueId } from '../types'

export interface EspnEvent {
  id: string
  date: string
  competitions: Array<{
    competitors: Array<{
      homeAway: 'home' | 'away'
      team: { displayName: string; abbreviation: string }
    }>
    status: { type: { name: string } }
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

  return {
    gameId: `${league}_${event.id}`,
    league,
    teamHome: home.team.displayName,
    teamAway: away.team.displayName,
    startTime,
    status,
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
