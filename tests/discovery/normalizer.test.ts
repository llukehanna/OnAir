import { normalizeEvents } from '../../src/main/discovery/normalizer'

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeEspnEvent(overrides: Partial<{
  id: string
  date: string
  statusName: string
  homeName: string
  awayName: string
  rich: boolean
}> = {}) {
  const rich = overrides.rich ?? false
  return {
    id: overrides.id ?? '401585566',
    date: overrides.date ?? '2026-03-18T00:00:00Z',
    competitions: [{
      competitors: [
        {
          homeAway: 'home' as const,
          team: {
            displayName: overrides.homeName ?? 'Los Angeles Lakers',
            abbreviation: 'LAL',
            ...(rich ? {
              shortDisplayName: 'Lakers',
              color: '552583',
              alternateColor: 'FDB927',
              logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lal.png',
            } : {}),
          },
          ...(rich ? { score: '91', records: [{ summary: '38-14' }] } : {}),
        },
        {
          homeAway: 'away' as const,
          team: {
            displayName: overrides.awayName ?? 'Boston Celtics',
            abbreviation: 'BOS',
            ...(rich ? {
              shortDisplayName: 'Celtics',
              color: '007A33',
              alternateColor: 'ffffff',
              logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png',
            } : {}),
          },
          ...(rich ? { score: overrides.statusName === 'STATUS_SCHEDULED' ? '0' : '88', records: [{ summary: '40-12' }] } : {}),
        },
      ],
      status: {
        type: {
          name: overrides.statusName ?? 'STATUS_IN_PROGRESS',
          ...(rich ? { shortDetail: 'Q3 - 4:12' } : {}),
        },
      },
      ...(rich ? {
        broadcasts: [{ names: ['ESPN'] }],
        venue: { fullName: 'Crypto.com Arena' },
      } : {}),
    }]
  }
}

// ---------------------------------------------------------------------------
// DISC-02: normalizeEvents output shape
// ---------------------------------------------------------------------------

describe('normalizeEvents', () => {
  it('maps a single in-progress ESPN event to a Game with correct shape', () => {
    const events = [makeEspnEvent()]
    const games = normalizeEvents(events, 'nba')
    expect(games).toHaveLength(1)
    const game = games[0]
    expect(game.gameId).toBe('nba_401585566')
    expect(game.league).toBe('nba')
    expect(game.teamHome).toBe('Los Angeles Lakers')
    expect(game.teamAway).toBe('Boston Celtics')
    expect(game.startTime).toBe(Date.parse('2026-03-18T00:00:00Z'))  // 1742256000000
    expect(game.status).toBe('LIVE')
  })

  it('returns [] when event is missing competitions array', () => {
    const events = [{ id: '999', date: '2026-03-18T00:00:00Z', competitions: [] }]
    const games = normalizeEvents(events, 'nba')
    expect(games).toHaveLength(0)
  })

  it('returns [] when competitors has no home entry', () => {
    const event = {
      id: '888',
      date: '2026-03-18T00:00:00Z',
      competitions: [{
        competitors: [
          { homeAway: 'away', team: { displayName: 'Boston Celtics', abbreviation: 'BOS' } },
        ],
        status: { type: { name: 'STATUS_IN_PROGRESS' } }
      }]
    }
    const games = normalizeEvents([event], 'nba')
    expect(games).toHaveLength(0)
  })

  it('returns Game[] of length 2 when given two valid events', () => {
    const events = [
      makeEspnEvent({ id: '111', homeName: 'Lakers', awayName: 'Celtics' }),
      makeEspnEvent({ id: '222', homeName: 'Warriors', awayName: 'Bucks' }),
    ]
    const games = normalizeEvents(events, 'nba')
    expect(games).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// DISC-03: mapStatus behavior (tested via normalizeEvents)
// ---------------------------------------------------------------------------

describe('mapStatus via normalizeEvents', () => {
  it('STATUS_IN_PROGRESS → LIVE', () => {
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_IN_PROGRESS' })], 'nba')
    expect(game.status).toBe('LIVE')
  })

  it('STATUS_HALFTIME → LIVE', () => {
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_HALFTIME' })], 'nba')
    expect(game.status).toBe('LIVE')
  })

  it('STATUS_END_PERIOD → LIVE', () => {
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_END_PERIOD' })], 'nba')
    expect(game.status).toBe('LIVE')
  })

  it('STATUS_SCHEDULED with startTime 30 min from now → STARTING_SOON', () => {
    const soonDate = new Date(Date.now() + 30 * 60_000).toISOString()
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_SCHEDULED', date: soonDate })], 'nba')
    expect(game.status).toBe('STARTING_SOON')
  })

  it('STATUS_SCHEDULED with startTime 90 min from now → SCHEDULED', () => {
    const laterDate = new Date(Date.now() + 90 * 60_000).toISOString()
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_SCHEDULED', date: laterDate })], 'nba')
    expect(game.status).toBe('SCHEDULED')
  })

  it('STATUS_FINAL with startTime 1 hour ago → RECENTLY_ENDED', () => {
    const recentDate = new Date(Date.now() - 60 * 60_000).toISOString()
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_FINAL', date: recentDate })], 'nba')
    expect(game.status).toBe('RECENTLY_ENDED')
  })

  it('STATUS_FINAL with startTime 4 hours ago → excluded (normalizeEvents returns [])', () => {
    const oldDate = new Date(Date.now() - 4 * 60 * 60_000).toISOString()
    const games = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_FINAL', date: oldDate })], 'nba')
    expect(games).toHaveLength(0)
  })

  it('unknown ESPN status → SCHEDULED (safe default)', () => {
    const [game] = normalizeEvents([makeEspnEvent({ statusName: 'STATUS_UNKNOWN_FOO' })], 'nba')
    expect(game.status).toBe('SCHEDULED')
  })
})

// ---------------------------------------------------------------------------
// Team / game detail (logos, colors, scores, clock)
// ---------------------------------------------------------------------------

describe('normalizeEvents detail', () => {
  it('extracts team detail, status detail, network and venue', () => {
    const [game] = normalizeEvents([makeEspnEvent({ rich: true })], 'nfl')
    expect(game.away).toEqual({
      abbr: 'BOS', shortName: 'Celtics', color: '#007a33', altColor: '#ffffff',
      logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png', score: 88, record: '40-12',
    })
    expect(game.home?.abbr).toBe('LAL')
    expect(game.home?.score).toBe(91)
    expect(game.statusDetail).toBe('Q3 - 4:12')
    expect(game.network).toBe('ESPN')
    expect(game.venue).toBe('Crypto.com Arena')
  })

  it('leaves detail null-safe when ESPN omits optional fields', () => {
    const [game] = normalizeEvents([makeEspnEvent()], 'nba')
    expect(game.away).toEqual({
      abbr: 'BOS', shortName: 'Boston Celtics', color: null, altColor: null, logo: null, score: null, record: null,
    })
    expect(game.statusDetail).toBeUndefined()
    expect(game.network).toBeUndefined()
    expect(game.venue).toBeUndefined()
  })

  it('treats a scheduled game score of "0" as no score', () => {
    const [game] = normalizeEvents([makeEspnEvent({ rich: true, statusName: 'STATUS_SCHEDULED', date: new Date(Date.now() + 86_400_000).toISOString() })], 'nba')
    expect(game.away?.score).toBeNull()
    expect(game.home?.score).toBeNull()
  })

  it('rejects malformed team colors', () => {
    const event = makeEspnEvent({ rich: true })
    const away = event.competitions[0].competitors[1].team as Record<string, unknown>
    away.color = '#007a33'
    away.alternateColor = 'zzzzzz'
    const [game] = normalizeEvents([event], 'nba')
    expect(game.away?.color).toBeNull()
    expect(game.away?.altColor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MLB and statuses beyond the basic four
// ---------------------------------------------------------------------------

type RawOverrides = {
  statusName?: string
  date?: string
  broadcasts?: Array<{ market?: string; names?: string[] }>
  geoBroadcasts?: Array<{ market?: { type?: string }; type?: { shortName?: string }; media?: { shortName?: string } }>
  notes?: Array<{ headline?: string }>
}

function mlbEvent(o: RawOverrides = {}) {
  return {
    id: '401700001',
    date: o.date ?? new Date(Date.now() - 30 * 60_000).toISOString(),
    competitions: [{
      competitors: [
        { homeAway: 'home', score: '3', team: { displayName: 'Atlanta Braves', abbreviation: 'ATL' } },
        { homeAway: 'away', score: '2', team: { displayName: 'Philadelphia Phillies', abbreviation: 'PHI' } },
      ],
      status: { type: { name: o.statusName ?? 'STATUS_IN_PROGRESS', shortDetail: 'Top 7th' } },
      broadcasts: o.broadcasts,
      geoBroadcasts: o.geoBroadcasts,
      notes: o.notes,
    }],
  }
}

describe('normalizeEvents MLB', () => {
  it('normalizes an MLB game under the mlb league', () => {
    const [game] = normalizeEvents([mlbEvent()], 'mlb')
    expect(game.gameId).toBe('mlb_401700001')
    expect(game.league).toBe('mlb')
    expect(game.statusDetail).toBe('Top 7th')
  })

  it.each(['STATUS_CANCELED', 'STATUS_POSTPONED', 'STATUS_SUSPENDED'])('drops %s games', (statusName) => {
    expect(normalizeEvents([mlbEvent({ statusName })], 'mlb')).toHaveLength(0)
  })

  it('treats a delay after first pitch as live', () => {
    const [game] = normalizeEvents([mlbEvent({ statusName: 'STATUS_RAIN_DELAY' })], 'mlb')
    expect(game.status).toBe('LIVE')
  })

  it('treats a delay before first pitch as not yet started', () => {
    const later = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    const soon = new Date(Date.now() + 20 * 60_000).toISOString()
    expect(normalizeEvents([mlbEvent({ statusName: 'STATUS_DELAYED', date: later })], 'mlb')[0].status).toBe('SCHEDULED')
    expect(normalizeEvents([mlbEvent({ statusName: 'STATUS_DELAYED', date: soon })], 'mlb')[0].status).toBe('STARTING_SOON')
  })

  it('prefers the national TV network over streaming', () => {
    const [game] = normalizeEvents([mlbEvent({
      broadcasts: [{ market: 'national', names: ['Peacock', 'NBCSN'] }],
      geoBroadcasts: [
        { market: { type: 'National' }, type: { shortName: 'Streaming' }, media: { shortName: 'Peacock' } },
        { market: { type: 'National' }, type: { shortName: 'TV' }, media: { shortName: 'NBCSN' } },
      ],
    })], 'mlb')
    expect(game.network).toBe('NBCSN')
  })

  it('falls back to a regional TV network when nothing national is on TV', () => {
    const [game] = normalizeEvents([mlbEvent({
      broadcasts: [{ market: 'national', names: ['MLB.TV'] }, { market: 'home', names: ['MASN'] }],
      geoBroadcasts: [
        { market: { type: 'National' }, type: { shortName: 'Streaming' }, media: { shortName: 'MLB.TV' } },
        { market: { type: 'Home' }, type: { shortName: 'TV' }, media: { shortName: 'MASN' } },
      ],
    })], 'mlb')
    expect(game.network).toBe('MASN')
  })

  it('uses the first broadcast name when ESPN sends no geoBroadcasts', () => {
    const [game] = normalizeEvents([mlbEvent({ broadcasts: [{ names: ['FOX'] }] })], 'mlb')
    expect(game.network).toBe('FOX')
  })

  it('keeps the round note as the headline', () => {
    const [game] = normalizeEvents([mlbEvent({ notes: [{ headline: 'NLWC - Game 1' }] })], 'mlb')
    expect(game.headline).toBe('NLWC - Game 1')
  })
})
