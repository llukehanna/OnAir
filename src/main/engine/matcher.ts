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

// Shared cities (Chicago, New York, Los Angeles) are deliberately absent: a
// bare "Chicago" would match the Cubs and the White Sox alike.
const MLB_ALIASES: Record<string, string[]> = {
  'Arizona Diamondbacks':   ['Diamondbacks', 'D-backs', 'Dbacks', 'ARI', 'AZ', 'Arizona'],
  'Athletics':              ['Athletics', 'ATH', 'OAK', 'Oakland Athletics', 'Oakland', 'Sacramento'],
  'Atlanta Braves':         ['Braves', 'ATL', 'Atlanta'],
  'Baltimore Orioles':      ['Orioles', 'BAL', 'Baltimore'],
  'Boston Red Sox':         ['Red Sox', 'BOS', 'Boston'],
  'Chicago Cubs':           ['Cubs', 'CHC'],
  'Chicago White Sox':      ['White Sox', 'CHW', 'CWS'],
  'Cincinnati Reds':        ['Reds', 'CIN', 'Cincinnati'],
  'Cleveland Guardians':    ['Guardians', 'CLE', 'Cleveland'],
  'Colorado Rockies':       ['Rockies', 'COL', 'Colorado'],
  'Detroit Tigers':         ['Tigers', 'DET', 'Detroit'],
  'Houston Astros':         ['Astros', 'HOU', 'Houston'],
  'Kansas City Royals':     ['Royals', 'KC', 'KCR', 'Kansas City'],
  'Los Angeles Angels':     ['Angels', 'LAA', 'LA Angels', 'Anaheim'],
  'Los Angeles Dodgers':    ['Dodgers', 'LAD', 'LA Dodgers'],
  'Miami Marlins':          ['Marlins', 'MIA', 'Miami'],
  'Milwaukee Brewers':      ['Brewers', 'MIL', 'Milwaukee'],
  'Minnesota Twins':        ['Twins', 'MIN', 'Minnesota'],
  'New York Mets':          ['Mets', 'NYM', 'NY Mets'],
  'New York Yankees':       ['Yankees', 'NYY', 'NY Yankees'],
  'Philadelphia Phillies':  ['Phillies', 'PHI', 'Philadelphia'],
  'Pittsburgh Pirates':     ['Pirates', 'PIT', 'Pittsburgh'],
  'San Diego Padres':       ['Padres', 'SD', 'SDP', 'San Diego'],
  'San Francisco Giants':   ['Giants', 'SF', 'SFG', 'San Francisco'],
  'Seattle Mariners':       ['Mariners', 'SEA', 'Seattle'],
  'St. Louis Cardinals':    ['Cardinals', 'STL', 'St. Louis', 'St Louis'],
  'Tampa Bay Rays':         ['Rays', 'TB', 'TBR', 'Tampa Bay'],
  'Texas Rangers':          ['Rangers', 'TEX', 'Texas'],
  'Toronto Blue Jays':      ['Blue Jays', 'TOR', 'Toronto', 'Jays'],
  'Washington Nationals':   ['Nationals', 'WSH', 'WAS', 'Washington', 'Nats'],
}

// Keys are ESPN's displayName. Left out on purpose: bare 'New York' (two
// teams), bare 'LA' (every LA franchise in every league), 'Wild' ("Wild
// Card") and 'Hawks' (Atlanta's NBA team).
const NHL_ALIASES: Record<string, string[]> = {
  'Anaheim Ducks':          ['Ducks', 'ANA', 'Anaheim'],
  'Boston Bruins':          ['Bruins', 'BOS', 'Boston'],
  'Buffalo Sabres':         ['Sabres', 'BUF', 'Buffalo'],
  'Calgary Flames':         ['Flames', 'CGY', 'Calgary'],
  'Carolina Hurricanes':    ['Hurricanes', 'CAR', 'Carolina', 'Canes'],
  'Chicago Blackhawks':     ['Blackhawks', 'CHI', 'Chicago'],
  'Colorado Avalanche':     ['Avalanche', 'COL', 'Colorado', 'Avs'],
  'Columbus Blue Jackets':  ['Blue Jackets', 'CBJ', 'Columbus', 'Jackets'],
  'Dallas Stars':           ['Stars', 'DAL', 'Dallas'],
  'Detroit Red Wings':      ['Red Wings', 'DET', 'Detroit', 'Wings'],
  'Edmonton Oilers':        ['Oilers', 'EDM', 'Edmonton'],
  'Florida Panthers':       ['Panthers', 'FLA', 'Florida'],
  'Los Angeles Kings':      ['Kings', 'LAK', 'LA Kings'],
  'Minnesota Wild':         ['MIN', 'Minnesota'],
  'Montreal Canadiens':     ['Canadiens', 'MTL', 'Montreal', 'Montréal', 'Habs'],
  'Nashville Predators':    ['Predators', 'NSH', 'Nashville', 'Preds'],
  'New Jersey Devils':      ['Devils', 'NJ', 'NJD', 'New Jersey'],
  'New York Islanders':     ['Islanders', 'NYI', 'NY Islanders', 'Isles'],
  'New York Rangers':       ['Rangers', 'NYR', 'NY Rangers'],
  'Ottawa Senators':        ['Senators', 'OTT', 'Ottawa', 'Sens'],
  'Philadelphia Flyers':    ['Flyers', 'PHI', 'Philadelphia', 'Philly'],
  'Pittsburgh Penguins':    ['Penguins', 'PIT', 'Pittsburgh', 'Pens'],
  'San Jose Sharks':        ['Sharks', 'SJ', 'SJS', 'San Jose'],
  'Seattle Kraken':         ['Kraken', 'SEA', 'Seattle'],
  'St. Louis Blues':        ['Blues', 'STL', 'St. Louis', 'St Louis'],
  'Tampa Bay Lightning':    ['Lightning', 'TB', 'TBL', 'Tampa Bay', 'Bolts'],
  'Toronto Maple Leafs':    ['Maple Leafs', 'TOR', 'Toronto', 'Leafs'],
  'Utah Mammoth':           ['Mammoth', 'UTAH', 'UTA', 'Utah', 'Utah Hockey Club', 'Utah HC'],
  'Vancouver Canucks':      ['Canucks', 'VAN', 'Vancouver'],
  'Vegas Golden Knights':   ['Golden Knights', 'VGK', 'Vegas', 'Knights'],
  'Washington Capitals':    ['Capitals', 'WSH', 'Washington', 'Caps'],
  'Winnipeg Jets':          ['Jets', 'WPG', 'Winnipeg'],
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
  mlb: MLB_ALIASES,
  nhl: NHL_ALIASES,
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

/** Lowercase words separated by single spaces; punctuation becomes a break. */
function toWords(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// ─── Cross-league names ───────────────────────────────────────────────────────
// Leagues share cities and nicknames, and their seasons overlap: a listing
// "Boston Celtics vs Toronto Raptors" contains "Boston" and "Toronto", which
// would otherwise match a Bruins–Maple Leafs game at 0.9. Every multi-word
// name any team goes by, tagged with its owner, lets matchTeam tell that a
// shorter alias only appeared inside some other team's name.

interface TeamPhrase {
  owner: string
  words: string
}

const TEAM_PHRASES: TeamPhrase[] = Object.values(ALIASES).flatMap((teams) =>
  Object.entries(teams).flatMap(([full, aliases]) =>
    [full, ...aliases]
      .map((name) => ({ owner: toWords(full), words: toWords(name) }))
      .filter((p) => p.words.includes(' '))
  )
)

/**
 * True when every place `alias` appears in `text` is explained by a longer
 * name belonging to a different team — "boston" inside "boston celtics"
 * when the team being matched is the Bruins.
 */
function onlyInsideOtherTeam(alias: string, teamName: string, ownNames: Set<string>, text: string): boolean {
  const owner = toWords(teamName)
  const needle = ` ${alias} `
  let rest = text
  for (const p of TEAM_PHRASES) {
    if (p.owner === owner || p.words === alias || ownNames.has(p.words)) continue
    const phrase = ` ${p.words} `
    if (phrase.includes(needle) && rest.includes(phrase)) {
      rest = rest.split(phrase).join(' ')
    }
  }
  return rest !== text && !rest.includes(needle)
}

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

  // Whole words only: a bare substring test let 'NE' (Patriots) match
  // "network" and 'NO' (Saints) match "north".
  const text = ` ${toWords(normalizedText)} `
  const ownNames = new Set(candidates.map(toWords))

  for (const alias of candidates) {
    const aliasLower = toWords(alias)
    if (!aliasLower || !text.includes(` ${aliasLower} `)) continue
    if (onlyInsideOtherTeam(aliasLower, teamName, ownNames, text)) continue

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
