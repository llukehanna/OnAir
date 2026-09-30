import { matchGame, matchTeam } from '../../src/main/engine/matcher'
import type { Game } from '../../src/main/types'

// Helper to build a minimal Game object
function makeGame(
  league: Game['league'],
  teamHome: string,
  teamAway: string
): Game {
  return {
    gameId: 'test-game',
    league,
    teamHome,
    teamAway,
    startTime: Date.now(),
    status: 'LIVE',
  }
}

// ─── matchGame: NBA ───────────────────────────────────────────────────────────

describe('matchGame NBA', () => {
  const game = makeGame('nba', 'Los Angeles Lakers', 'Golden State Warriors')

  it('returns 0.9 when both teams appear in sourceText', () => {
    expect(matchGame(game, 'lakers vs warriors')).toBe(0.9)
  })

  it('returns 0.9 with full team names', () => {
    expect(matchGame(game, 'Los Angeles Lakers vs Golden State Warriors')).toBe(0.9)
  })

  it('returns 0.9 using abbreviations for both teams', () => {
    expect(matchGame(game, 'LAL vs GSW live stream')).toBe(0.9)
  })

  it('returns 0.5 when only home team matches', () => {
    expect(matchGame(game, 'Watch Lakers tonight')).toBe(0.5)
  })

  it('returns 0.5 when only away team matches', () => {
    expect(matchGame(game, 'Golden State Warriors game')).toBe(0.5)
  })

  it('returns 0 when neither team matches', () => {
    expect(matchGame(game, 'random text about nothing')).toBe(0)
  })

  it('is case insensitive: LAKERS VS WARRIORS -> 0.9', () => {
    expect(matchGame(game, 'LAKERS VS WARRIORS')).toBe(0.9)
  })

  it('strips punctuation: Lakers-vs-Warriors! -> 0.9', () => {
    expect(matchGame(game, 'Lakers-vs-Warriors!')).toBe(0.9)
  })
})

// ─── matchGame: NFL ───────────────────────────────────────────────────────────

describe('matchGame NFL', () => {
  const game = makeGame('nfl', 'Kansas City Chiefs', 'Baltimore Ravens')

  it('returns 0.9 for chiefs vs ravens', () => {
    expect(matchGame(game, 'chiefs vs ravens')).toBe(0.9)
  })

  it('returns 0.9 via abbreviations KC vs BAL', () => {
    expect(matchGame(game, 'KC vs BAL')).toBe(0.9)
  })

  it('returns 0.9 via full names', () => {
    expect(matchGame(game, 'Kansas City Chiefs vs Baltimore Ravens')).toBe(0.9)
  })

  it('returns 0.5 when only Chiefs matches', () => {
    expect(matchGame(game, 'Kansas City Chiefs stream')).toBe(0.5)
  })

  it('returns 0 when no match', () => {
    expect(matchGame(game, 'NBA finals highlights')).toBe(0)
  })

  // Additional NFL variant
  it('returns 0.9 for Dallas Cowboys vs New England Patriots via abbreviations', () => {
    const g = makeGame('nfl', 'Dallas Cowboys', 'New England Patriots')
    expect(matchGame(g, 'DAL vs NE live')).toBe(0.9)
  })
})

// ─── matchGame: CBB ───────────────────────────────────────────────────────────

describe('matchGame CBB', () => {
  it('returns 0.9 for duke vs north carolina (school names)', () => {
    const game = makeGame('cbb', 'Duke Blue Devils', 'North Carolina Tar Heels')
    expect(matchGame(game, 'duke vs north carolina')).toBe(0.9)
  })

  it('returns 0.9 using UNC abbreviation', () => {
    const game = makeGame('cbb', 'Duke Blue Devils', 'North Carolina Tar Heels')
    expect(matchGame(game, 'Duke vs UNC rivalry')).toBe(0.9)
  })

  it('returns 0.3 for CBB nickname-only match: "tigers" alone for Auburn Tigers', () => {
    const game = makeGame('cbb', 'Auburn Tigers', 'Kentucky Wildcats')
    // Only "tigers" in text — ambiguous nickname, no school name
    expect(matchGame(game, 'Watch the tigers tonight')).toBe(0.3)
  })

  it('does NOT reduce to 0.3 when full name "auburn tigers" is present (school + nickname)', () => {
    const game = makeGame('cbb', 'Auburn Tigers', 'Duke Blue Devils')
    expect(matchGame(game, 'auburn tigers vs duke')).toBe(0.9)
  })

  it('returns 0.9 for Kansas vs Duke using school names', () => {
    const game = makeGame('cbb', 'Kansas Jayhawks', 'Duke Blue Devils')
    expect(matchGame(game, 'Kansas vs Duke game stream')).toBe(0.9)
  })

  it('returns 0.9 for Michigan State MSU abbreviation', () => {
    const game = makeGame('cbb', 'Michigan State Spartans', 'Duke Blue Devils')
    expect(matchGame(game, 'MSU vs Duke')).toBe(0.9)
  })
})

// ─── matchGame: CFB ───────────────────────────────────────────────────────────

describe('matchGame CFB', () => {
  it('returns 0.9 for Alabama vs Georgia', () => {
    const game = makeGame('cfb', 'Alabama Crimson Tide', 'Georgia Bulldogs')
    expect(matchGame(game, 'Alabama vs Georgia')).toBe(0.9)
  })

  it('returns 0.9 using Bama nickname', () => {
    const game = makeGame('cfb', 'Alabama Crimson Tide', 'Ohio State Buckeyes')
    expect(matchGame(game, 'Bama vs Ohio State')).toBe(0.9)
  })

  it('returns 0.9 using OSU abbreviation', () => {
    const game = makeGame('cfb', 'Alabama Crimson Tide', 'Ohio State Buckeyes')
    expect(matchGame(game, 'Alabama vs OSU CFB playoff')).toBe(0.9)
  })

  it('returns 0.3 for CFB nickname-only match: "wildcats" alone for Arizona Wildcats', () => {
    const game = makeGame('cfb', 'Arizona Wildcats', 'Oregon Ducks')
    // Only "wildcats" in text — ambiguous nickname
    expect(matchGame(game, 'Wildcats game tonight')).toBe(0.3)
  })

  it('returns 0.9 for Notre Dame vs Michigan', () => {
    const game = makeGame('cfb', 'Notre Dame Fighting Irish', 'Michigan Wolverines')
    expect(matchGame(game, 'Notre Dame vs Michigan rivalry')).toBe(0.9)
  })

  it('returns 0.9 via Irish nickname for Notre Dame', () => {
    const game = makeGame('cfb', 'Notre Dame Fighting Irish', 'USC Trojans')
    expect(matchGame(game, 'Irish vs USC')).toBe(0.9)
  })
})

// ─── matchTeam: direct tests ──────────────────────────────────────────────────

describe('matchTeam NBA', () => {
  it('resolves "LAL" to Los Angeles Lakers', () => {
    const result = matchTeam('Los Angeles Lakers', 'nba', 'lal stream live')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('resolves "Celtics" to Boston Celtics', () => {
    const result = matchTeam('Boston Celtics', 'nba', 'celtics game tonight')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('returns 0 for no match', () => {
    const result = matchTeam('Los Angeles Lakers', 'nba', 'random text')
    expect(result.score).toBe(0)
  })
})

describe('matchTeam NFL', () => {
  it('resolves "ATL" to Atlanta Falcons', () => {
    const result = matchTeam('Atlanta Falcons', 'nfl', 'atl vs nfc')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('resolves "Chiefs" to Kansas City Chiefs', () => {
    const result = matchTeam('Kansas City Chiefs', 'nfl', 'chiefs are playing')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })
})

describe('matchTeam CBB', () => {
  it('resolves "Duke" (school name) to Duke Blue Devils', () => {
    const result = matchTeam('Duke Blue Devils', 'cbb', 'duke basketball stream')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('resolves "UNC" abbreviation to North Carolina Tar Heels', () => {
    const result = matchTeam('North Carolina Tar Heels', 'cbb', 'unc vs duke')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('returns nicknameOnly=true when only ambiguous nickname "Tigers" matches (CBB)', () => {
    const result = matchTeam('Auburn Tigers', 'cbb', 'tigers game')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(true)
  })

  it('returns nicknameOnly=false when "auburn tigers" (school+nickname) matches', () => {
    const result = matchTeam('Auburn Tigers', 'cbb', 'auburn tigers stream')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })
})

describe('matchTeam CFB', () => {
  it('resolves "Bama" to Alabama Crimson Tide', () => {
    const result = matchTeam('Alabama Crimson Tide', 'cfb', 'bama is up by 7')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('resolves "OSU" to Ohio State Buckeyes', () => {
    const result = matchTeam('Ohio State Buckeyes', 'cfb', 'osu is playing today')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(false)
  })

  it('returns nicknameOnly=true when only ambiguous nickname "Wildcats" matches (CFB)', () => {
    const result = matchTeam('Arizona Wildcats', 'cfb', 'wildcats game')
    expect(result.score).toBe(1.0)
    expect(result.nicknameOnly).toBe(true)
  })
})

// ─── CBB nickname-only edge cases ────────────────────────────────────────────

describe('CBB/CFB nickname-only edge cases for matchGame', () => {
  it('CBB: both teams have ambiguous nicknames only → 0.3', () => {
    // Tigers (Auburn) and Wildcats (Kentucky) — both ambiguous nickname-only
    const game = makeGame('cbb', 'Auburn Tigers', 'Kentucky Wildcats')
    expect(matchGame(game, 'tigers vs wildcats')).toBe(0.3)
  })

  it('CBB: one team has ambiguous nickname, other has school name → 0.9', () => {
    // "Kentucky" (non-ambiguous school name) + "tigers" (ambiguous)
    const game = makeGame('cbb', 'Auburn Tigers', 'Kentucky Wildcats')
    // "Kentucky" is a school name alias (non-ambiguous), "tigers" is ambiguous
    expect(matchGame(game, 'kentucky vs tigers')).toBe(0.9)
  })

  it('CFB: both teams have ambiguous nicknames only → 0.3', () => {
    const game = makeGame('cfb', 'Arizona Wildcats', 'Baylor Bears')
    expect(matchGame(game, 'wildcats vs bears')).toBe(0.3)
  })
})

describe('MLB matching', () => {
  it('matches both teams of an MLB listing', () => {
    const game = makeGame('mlb', 'Boston Red Sox', 'Chicago White Sox')
    expect(matchGame(game, 'White Sox at Red Sox')).toBe(0.9)
  })

  it('does not treat a bare "Sox" as either Sox team', () => {
    expect(matchTeam('Boston Red Sox', 'mlb', 'sox rivalry tonight').score).toBe(0)
    expect(matchTeam('Chicago White Sox', 'mlb', 'sox rivalry tonight').score).toBe(0)
  })

  it('matches St. Louis written with its period', () => {
    const game = makeGame('mlb', 'St. Louis Cardinals', 'Chicago Cubs')
    expect(matchGame(game, 'Cubs vs. St. Louis Cardinals')).toBe(0.9)
  })

  it('matches two-letter abbreviations as whole words', () => {
    expect(matchTeam('San Diego Padres', 'mlb', 'sd vs sf').score).toBe(1)
  })
})

describe('whole-word matching', () => {
  it('does not match a short abbreviation inside another word', () => {
    // 'NE' (Patriots) and 'NO' (Saints) used to match any text containing those letters.
    expect(matchTeam('New England Patriots', 'nfl', 'monday night football network').score).toBe(0)
    expect(matchTeam('New Orleans Saints', 'nfl', 'north carolina').score).toBe(0)
  })

  it('still matches an abbreviation standing on its own', () => {
    expect(matchTeam('New England Patriots', 'nfl', 'ne at buf').score).toBe(1)
  })
})

describe('NHL matching', () => {
  const game = makeGame('nhl', 'Toronto Maple Leafs', 'Montreal Canadiens')

  it('matches nicknames, cities and ESPN abbreviations', () => {
    expect(matchGame(game, 'Canadiens vs Maple Leafs')).toBe(0.9)
    expect(matchGame(game, 'Montreal at Toronto')).toBe(0.9)
    expect(matchGame(game, 'MTL @ TOR')).toBe(0.9)
    expect(matchGame(game, 'Habs vs Leafs')).toBe(0.9)
  })

  it('matches the accented Montréal spelling', () => {
    expect(matchTeam('Montreal Canadiens', 'nhl', 'Montréal Canadiens').score).toBe(1)
  })

  it("matches Utah under both the Mammoth and its old Hockey Club name", () => {
    expect(matchTeam('Utah Mammoth', 'nhl', 'utah hockey club vs kraken').score).toBe(1)
    expect(matchTeam('Utah Mammoth', 'nhl', 'mammoth vs kraken').score).toBe(1)
  })

  it('does not treat "Wild Card" as the Minnesota Wild', () => {
    expect(matchTeam('Minnesota Wild', 'nhl', 'nfl wild card round').score).toBe(0)
  })
})

describe('cross-league name collisions', () => {
  it('does not match an NHL game from an NBA listing in the same cities', () => {
    const game = makeGame('nhl', 'Boston Bruins', 'Toronto Maple Leafs')
    expect(matchGame(game, 'Boston Celtics vs Toronto Raptors')).toBe(0)
  })

  it('does not match an NBA game from an NHL listing in the same cities', () => {
    const game = makeGame('nba', 'Boston Celtics', 'Toronto Raptors')
    expect(matchGame(game, 'Toronto Maple Leafs @ Boston Bruins')).toBe(0)
  })

  it('does not match a shared nickname qualified by another city', () => {
    expect(matchTeam('Los Angeles Kings', 'nhl', 'sacramento kings vs nuggets').score).toBe(0)
    expect(matchTeam('New Jersey Devils', 'nhl', 'duke blue devils vs unc').score).toBe(0)
  })

  it('still matches when the city also appears on its own', () => {
    const game = makeGame('nhl', 'Boston Bruins', 'Toronto Maple Leafs')
    expect(matchGame(game, 'Toronto Maple Leafs vs Boston')).toBe(0.9)
  })

  it('still matches bare city names', () => {
    const game = makeGame('nhl', 'Boston Bruins', 'Toronto Maple Leafs')
    expect(matchGame(game, 'Toronto vs Boston')).toBe(0.9)
  })

  it('keeps a college match from firing on a sibling school', () => {
    expect(matchTeam('Oklahoma Sooners', 'cfb', 'oklahoma state cowboys vs baylor').score).toBe(0)
  })
})
