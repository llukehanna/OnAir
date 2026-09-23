import type { LeagueId, Game } from '../types'

// ─── Alias Dictionaries ───────────────────────────────────────────────────────

const NBA_ALIASES: Record<string, string[]> = {
  'Atlanta Hawks':          ['Hawks', 'ATL', 'Atlanta'],
  'Boston Celtics':         ['Celtics', 'BOS', 'Boston'],
  'Brooklyn Nets':          ['Nets', 'BKN', 'Brooklyn'],
  'Charlotte Hornets':      ['Hornets', 'CHA', 'Charlotte'],
  'Chicago Bulls':          ['Bulls', 'CHI', 'Chicago'],
  'Cleveland Cavaliers':    ['Cavaliers', 'CLE', 'Cleveland', 'Cavs'],
  'Dallas Mavericks':       ['Mavericks', 'DAL', 'Dallas', 'Mavs'],
  'Denver Nuggets':         ['Nuggets', 'DEN', 'Denver'],
  'Detroit Pistons':        ['Pistons', 'DET', 'Detroit'],
  'Golden State Warriors':  ['Warriors', 'GSW', 'Golden State', 'GS Warriors', 'Golden St'],
  'Houston Rockets':        ['Rockets', 'HOU', 'Houston'],
  'Indiana Pacers':         ['Pacers', 'IND', 'Indiana'],
  'LA Clippers':            ['Clippers', 'LAC', 'LA Clippers', 'Los Angeles Clippers'],
  'Los Angeles Lakers':     ['Lakers', 'LAL', 'LA Lakers', 'Los Angeles Lakers'],
  'Memphis Grizzlies':      ['Grizzlies', 'MEM', 'Memphis', 'Grizz'],
  'Miami Heat':             ['Heat', 'MIA', 'Miami'],
  'Milwaukee Bucks':        ['Bucks', 'MIL', 'Milwaukee'],
  'Minnesota Timberwolves': ['Timberwolves', 'MIN', 'Minnesota', 'Wolves', 'TWolves'],
  'New Orleans Pelicans':   ['Pelicans', 'NOP', 'New Orleans', 'NO Pelicans'],
  'New York Knicks':        ['Knicks', 'NYK', 'New York'],
  'Oklahoma City Thunder':  ['Thunder', 'OKC', 'Oklahoma City', 'Oklahoma'],
  'Orlando Magic':          ['Magic', 'ORL', 'Orlando'],
  'Philadelphia 76ers':     ['76ers', 'PHI', 'Philadelphia', 'Sixers', 'Philly'],
  'Phoenix Suns':           ['Suns', 'PHX', 'Phoenix'],
  'Portland Trail Blazers': ['Trail Blazers', 'POR', 'Portland', 'Blazers'],
  'Sacramento Kings':       ['Kings', 'SAC', 'Sacramento'],
  'San Antonio Spurs':      ['Spurs', 'SAS', 'San Antonio'],
  'Toronto Raptors':        ['Raptors', 'TOR', 'Toronto'],
  'Utah Jazz':              ['Jazz', 'UTA', 'Utah'],
  'Washington Wizards':     ['Wizards', 'WAS', 'Washington'],
}

const NFL_ALIASES: Record<string, string[]> = {
  'Arizona Cardinals':      ['Cardinals', 'ARI', 'Arizona'],
  'Atlanta Falcons':        ['Falcons', 'ATL', 'Atlanta'],
  'Baltimore Ravens':       ['Ravens', 'BAL', 'Baltimore'],
  'Buffalo Bills':          ['Bills', 'BUF', 'Buffalo'],
  'Carolina Panthers':      ['Panthers', 'CAR', 'Carolina'],
  'Chicago Bears':          ['Bears', 'CHI', 'Chicago'],
  'Cincinnati Bengals':     ['Bengals', 'CIN', 'Cincinnati'],
  'Cleveland Browns':       ['Browns', 'CLE', 'Cleveland'],
  'Dallas Cowboys':         ['Cowboys', 'DAL', 'Dallas'],
  'Denver Broncos':         ['Broncos', 'DEN', 'Denver'],
  'Detroit Lions':          ['Lions', 'DET', 'Detroit'],
  'Green Bay Packers':      ['Packers', 'GB', 'Green Bay'],
  'Houston Texans':         ['Texans', 'HOU', 'Houston'],
  'Indianapolis Colts':     ['Colts', 'IND', 'Indianapolis', 'Indy'],
  'Jacksonville Jaguars':   ['Jaguars', 'JAX', 'Jacksonville', 'Jags'],
  'Kansas City Chiefs':     ['Chiefs', 'KC', 'Kansas City'],
  'Las Vegas Raiders':      ['Raiders', 'LV', 'Las Vegas', 'Oakland Raiders'],
  'Los Angeles Chargers':   ['Chargers', 'LAC', 'LA Chargers', 'Los Angeles Chargers'],
  'Los Angeles Rams':       ['Rams', 'LAR', 'LA Rams', 'Los Angeles Rams'],
  'Miami Dolphins':         ['Dolphins', 'MIA', 'Miami'],
  'Minnesota Vikings':      ['Vikings', 'MIN', 'Minnesota'],
  'New England Patriots':   ['Patriots', 'NE', 'New England', 'Pats'],
  'New Orleans Saints':     ['Saints', 'NO', 'New Orleans'],
  'New York Giants':        ['Giants', 'NYG', 'New York Giants', 'NY Giants'],
  'New York Jets':          ['Jets', 'NYJ', 'New York Jets', 'NY Jets'],
  'Philadelphia Eagles':    ['Eagles', 'PHI', 'Philadelphia', 'Philly'],
  'Pittsburgh Steelers':    ['Steelers', 'PIT', 'Pittsburgh'],
  'San Francisco 49ers':    ['49ers', 'SF', 'San Francisco', 'Niners'],
  'Seattle Seahawks':       ['Seahawks', 'SEA', 'Seattle'],
  'Tampa Bay Buccaneers':   ['Buccaneers', 'TB', 'Tampa Bay', 'Tampa', 'Bucs'],
  'Tennessee Titans':       ['Titans', 'TEN', 'Tennessee'],
  'Washington Commanders':  ['Commanders', 'WAS', 'Washington', 'Washington Football Team', 'Redskins'],
}

const CBB_ALIASES: Record<string, string[]> = {
  'Duke Blue Devils':           ['Duke', 'Blue Devils'],
  'Kentucky Wildcats':          ['Kentucky', 'Wildcats', 'UK'],
  'Kansas Jayhawks':            ['Kansas', 'Jayhawks', 'KU'],
  'North Carolina Tar Heels':   ['North Carolina', 'UNC', 'Tar Heels', 'Carolina'],
  'Gonzaga Bulldogs':           ['Gonzaga', 'Bulldogs', 'Zags'],
  'Villanova Wildcats':         ['Villanova', 'Nova'],
  'Michigan State Spartans':    ['Michigan State', 'MSU', 'Spartans'],
  'UCLA Bruins':                ['UCLA', 'Bruins'],
  'Arizona Wildcats':           ['Arizona', 'UA'],
  'Houston Cougars':            ['Houston', 'Cougars', 'UH'],
  'Alabama Crimson Tide':       ['Alabama', 'Bama'],
  'Arkansas Razorbacks':        ['Arkansas', 'Razorbacks'],
  'Auburn Tigers':              ['Auburn', 'Tigers'],
  'Baylor Bears':               ['Baylor', 'Bears'],
  'Connecticut Huskies':        ['Connecticut', 'UConn', 'Huskies'],
  'Creighton Bluejays':         ['Creighton', 'Bluejays'],
  'Florida Gators':             ['Florida', 'Gators', 'UF'],
  'Illinois Fighting Illini':   ['Illinois', 'Illini'],
  'Indiana Hoosiers':           ['Indiana', 'Hoosiers', 'IU'],
  'Iowa Hawkeyes':              ['Iowa', 'Hawkeyes'],
  'Louisville Cardinals':       ['Louisville', 'Cardinals'],
  'Marquette Golden Eagles':    ['Marquette', 'Golden Eagles'],
  'Maryland Terrapins':         ['Maryland', 'Terps', 'Terrapins'],
  'Memphis Tigers':             ['Memphis', 'Tigers'],
  'Michigan Wolverines':        ['Michigan', 'Wolverines'],
  'Missouri Tigers':            ['Missouri', 'Mizzou'],
  'Ohio State Buckeyes':        ['Ohio State', 'Buckeyes', 'OSU'],
  'Oregon Ducks':               ['Oregon', 'Ducks'],
  'Purdue Boilermakers':        ['Purdue', 'Boilermakers'],
  'San Diego State Aztecs':     ['San Diego State', 'SDSU', 'Aztecs'],
  "St. John's Red Storm":       ["St. John's", 'St Johns', 'Red Storm'],
  'Syracuse Orange':            ['Syracuse', 'Orange', 'Cuse'],
  'Tennessee Volunteers':       ['Tennessee', 'Vols', 'Volunteers', 'UT'],
  'Texas Longhorns':            ['Texas', 'Longhorns', 'UT'],
  'Texas A&M Aggies':           ['Texas A&M', 'TAMU', 'Aggies'],
  'Vanderbilt Commodores':      ['Vanderbilt', 'Vandy', 'Commodores'],
  'Virginia Cavaliers':         ['Virginia', 'Cavaliers', 'UVA', 'Wahoos'],
  'Wisconsin Badgers':          ['Wisconsin', 'Badgers'],
  'Xavier Musketeers':          ['Xavier', 'Musketeers'],
}

const CFB_ALIASES: Record<string, string[]> = {
  'Alabama Crimson Tide':       ['Alabama', 'Bama', 'Tide'],
  'Georgia Bulldogs':           ['Georgia', 'UGA', 'Dawgs', 'Bulldogs'],
  'Ohio State Buckeyes':        ['Ohio State', 'Buckeyes', 'OSU'],
  'Michigan Wolverines':        ['Michigan', 'Wolverines'],
  'Clemson Tigers':             ['Clemson', 'Tigers'],
  'Texas Longhorns':            ['Texas', 'Longhorns', 'Horns'],
  'Oklahoma Sooners':           ['Oklahoma', 'Sooners', 'OU'],
  'Penn State Nittany Lions':   ['Penn State', 'Nittany Lions', 'PSU'],
  'Notre Dame Fighting Irish':  ['Notre Dame', 'Fighting Irish', 'Irish', 'ND'],
  'Florida State Seminoles':    ['Florida State', 'Seminoles', 'FSU'],
  'LSU Tigers':                 ['LSU', 'Tigers'],
  'USC Trojans':                ['USC', 'Trojans'],
  'Oregon Ducks':               ['Oregon', 'Ducks'],
  'Tennessee Volunteers':       ['Tennessee', 'Vols', 'UT'],
  'Texas A&M Aggies':           ['Texas A&M', 'TAMU', 'Aggies'],
  'Miami Hurricanes':           ['Miami', 'Hurricanes', 'Canes', 'UM'],
  'Washington Huskies':         ['Washington', 'Huskies', 'UW'],
  'Utah Utes':                  ['Utah', 'Utes'],
  'Ole Miss Rebels':            ['Ole Miss', 'Rebels', 'Mississippi'],
  'Kansas State Wildcats':      ['Kansas State', 'K-State', 'KSU'],
  'Iowa Hawkeyes':              ['Iowa', 'Hawkeyes'],
  'Wisconsin Badgers':          ['Wisconsin', 'Badgers'],
  'Auburn Tigers':              ['Auburn', 'Tigers'],
  'Arkansas Razorbacks':        ['Arkansas', 'Razorbacks'],
  'Baylor Bears':               ['Baylor', 'Bears'],
  'Missouri Tigers':            ['Missouri', 'Mizzou'],
  'Mississippi State Bulldogs': ['Mississippi State', 'MSU', 'Miss State'],
  'South Carolina Gamecocks':   ['South Carolina', 'Gamecocks'],
  'Oklahoma State Cowboys':     ['Oklahoma State', 'Okie State', 'OSU'],
  'TCU Horned Frogs':           ['TCU', 'Horned Frogs'],
  'Colorado Buffaloes':         ['Colorado', 'Buffs', 'Buffaloes', 'CU'],
  'Arizona Wildcats':           ['Arizona', 'UA', 'Wildcats'],
  'Arizona State Sun Devils':   ['Arizona State', 'ASU', 'Sun Devils'],
  'UCLA Bruins':                ['UCLA', 'Bruins'],
  'California Golden Bears':    ['California', 'Cal', 'Bears', 'UC Berkeley'],
  'Stanford Cardinal':          ['Stanford', 'Cardinal'],
  'North Carolina Tar Heels':   ['North Carolina', 'UNC', 'Tar Heels'],
  'NC State Wolfpack':          ['NC State', 'Wolfpack'],
  'Virginia Tech Hokies':       ['Virginia Tech', 'Hokies', 'VT'],
  'Pittsburgh Panthers':        ['Pittsburgh', 'Pitt', 'Panthers'],
  'Syracuse Orange':            ['Syracuse', 'Orange'],
  'Boston College Eagles':      ['Boston College', 'Eagles', 'BC'],
  'Louisville Cardinals':       ['Louisville', 'Cardinals'],
}

const ALIASES: Record<LeagueId, Record<string, string[]>> = {
  nba: NBA_ALIASES,
  nfl: NFL_ALIASES,
  cbb: CBB_ALIASES,
  cfb: CFB_ALIASES,
}

// ─── Ambiguous Nicknames ──────────────────────────────────────────────────────
// Single-word nicknames shared across multiple CBB/CFB programs.
// Matching only these words (without a school/city name) is insufficient.

const AMBIGUOUS_NICKNAMES = new Set([
  'tigers', 'wildcats', 'bulldogs', 'cardinals', 'bears',
  'eagles', 'panthers', 'orange', 'volunteers', 'razorbacks',
  'commodores', 'rebels', 'cowboys', 'huskies', 'bruins',
])

// ─── matchTeam ────────────────────────────────────────────────────────────────

/**
 * Checks whether a given team appears in a (pre-normalized) source text.
 *
 * @returns `{ score: 1.0, nicknameOnly: boolean }` if a match is found,
 *          `{ score: 0, nicknameOnly: false }` if no match.
 *
 * `nicknameOnly` is true only for CBB/CFB matches on a single ambiguous
 * nickname (e.g. "tigers") without the school name present.
 */
export function matchTeam(
  teamName: string,
  league: LeagueId,
  normalizedText: string
): { score: number; nicknameOnly: boolean } {
  const aliases = ALIASES[league]?.[teamName] ?? []
  const candidates = [teamName, ...aliases]

  for (const alias of candidates) {
    const aliasLower = alias.toLowerCase()
    if (!normalizedText.includes(aliasLower)) continue

    // Match found — determine if it is a bare ambiguous nickname
    const isSingleWord = !aliasLower.includes(' ')
    const isAmbiguous = AMBIGUOUS_NICKNAMES.has(aliasLower)
    const isCollegeLeague = league === 'cbb' || league === 'cfb'

    if (isSingleWord && isAmbiguous && isCollegeLeague) {
      return { score: 1.0, nicknameOnly: true }
    }

    return { score: 1.0, nicknameOnly: false }
  }

  return { score: 0, nicknameOnly: false }
}

// ─── matchGame ────────────────────────────────────────────────────────────────

/**
 * Returns a confidence score (0–1) indicating how well `sourceText` matches
 * the given game.
 *
 *  0.9  — both teams found (with at least one non-ambiguous match)
 *  0.5  — exactly one team found (non-ambiguous)
 *  0.3  — only ambiguous single-word nickname(s) found (below useful threshold)
 *  0    — no team matched
 */
export function matchGame(game: Game, sourceText: string): number {
  const normalized = sourceText.toLowerCase().replace(/[^\w\s]/g, ' ')

  const home = matchTeam(game.teamHome, game.league, normalized)
  const away = matchTeam(game.teamAway, game.league, normalized)

  const homeMatched = home.score > 0
  const awayMatched = away.score > 0

  if (homeMatched && awayMatched) {
    // Both teams matched — check if BOTH are ambiguous nickname-only
    if (home.nicknameOnly && away.nicknameOnly) return 0.3
    return 0.9
  }

  if (homeMatched || awayMatched) {
    const matched = homeMatched ? home : away
    if (matched.nicknameOnly) return 0.3
    return 0.5
  }

  return 0
}
