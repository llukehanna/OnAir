/** Display order for league filters; also the order leagues appear in the top bar. */
export const LEAGUE_ORDER: LeagueId[] = ['nfl', 'nba', 'cfb', 'cbb']

const LEAGUE_LABEL: Record<LeagueId, string> = {
  nfl: 'NFL',
  nba: 'NBA',
  cfb: 'College Football',
  cbb: 'College Basketball',
}

const LEAGUE_SHORT: Record<LeagueId, string> = {
  nfl: 'NFL',
  nba: 'NBA',
  cfb: 'CFB',
  cbb: 'CBB',
}

export function leagueLabel(league: LeagueId): string {
  return LEAGUE_LABEL[league]
}

export function leagueShort(league: LeagueId): string {
  return LEAGUE_SHORT[league]
}

/**
 * The team on one side of a game. ESPN detail is optional (older rows, fixture
 * games), so fall back to what the name alone gives: a monogram, never the
 * first two letters of the city.
 */
export function teamOf(game: Game, side: 'away' | 'home'): TeamInfo {
  const detail = side === 'away' ? game.away : game.home
  if (detail) return detail
  const name = side === 'away' ? game.teamAway : game.teamHome
  const words = name.split(/\s+/).filter(Boolean)
  return {
    abbr: words.map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
    shortName: words.length > 1 ? words[words.length - 1] : name,
    color: null,
    altColor: null,
    logo: null,
    score: null,
    record: null,
  }
}

/** ESPN publishes a variant of every logo drawn for dark backgrounds. */
export function darkLogo(url: string | null): string | null {
  if (!url) return null
  return url.replace(/\/500\/(scoreboard\/)?/, '/500-dark/')
}

/**
 * A team's color, or a muted color derived from its name when ESPN gave none,
 * so a game without detail still gets two distinct, calm sides.
 */
export function teamColor(team: TeamInfo): string {
  if (team.color) return team.color
  let h = 0
  for (const ch of team.shortName) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 30% 30%)`
}

/** Leader of a scored game, or null when tied or unscored. */
export function leader(game: Game): 'away' | 'home' | null {
  const a = game.away?.score
  const h = game.home?.score
  if (a == null || h == null || a === h) return null
  return a > h ? 'away' : 'home'
}

export function hasScore(game: Game): boolean {
  return game.away?.score != null && game.home?.score != null
}

/** "Q3 - 4:12" reads better as "Q3 · 4:12". */
export function statusText(game: Game): string {
  const detail = game.statusDetail?.replace(/\s+-\s+/g, ' · ')
  if (game.status === 'LIVE') return detail ?? 'Live'
  if (game.status === 'RECENTLY_ENDED') return detail ?? 'Final'
  return detail ?? ''
}

export function matchupLabel(game: Game): string {
  return `${teamOf(game, 'away').shortName} at ${teamOf(game, 'home').shortName}`
}
