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
