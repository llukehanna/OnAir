import {
  GAME_MINUTES,
  gamePrograms,
  tvmazePrograms,
  mergePrograms,
  fetchTvmaze,
  fetchTvmazeCached,
  buildGuide,
  buildAndStoreGuide,
  getOrBuildGuide,
  getLatestGuide,
  resolveKnownChannelId,
  __resetTvmazeCacheForTests,
  __resetLatestGuideForTests,
  type TvmazeEpisode,
} from '../../src/main/channels/listings'
import type { Channel, Game, GuideProgram } from '../../src/main/types'

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    gameId: 'espn_123',
    league: 'mlb',
    teamHome: 'Dodgers',
    teamAway: 'Giants',
    startTime: Date.parse('2026-09-28T18:00:00Z'),
    status: 'SCHEDULED',
    ...overrides,
  }
}

function makeChannel(channelId: string, name: string): Channel {
  return { channelId, name, category: 'sports', sourceCount: 1, lastSeenAt: Date.now() }
}

// ---------------------------------------------------------------------------
// GAME_MINUTES
// ---------------------------------------------------------------------------

describe('GAME_MINUTES', () => {
  it('has the expected minute counts per league', () => {
    expect(GAME_MINUTES).toEqual({ nfl: 195, cfb: 210, mlb: 180, nba: 150, cbb: 120 })
  })
})

// ---------------------------------------------------------------------------
// gamePrograms
// ---------------------------------------------------------------------------

describe('gamePrograms', () => {
  it('turns a game on NBC into a 180-minute ch:nbc program for MLB', () => {
    const start = Date.parse('2026-09-28T18:00:00Z')
    const game = makeGame({ network: 'NBC', startTime: start })

    const [program] = gamePrograms([game])

    expect(program.channelId).toBe('ch:nbc')
    expect(program.kind).toBe('game')
    expect(program.gameId).toBe('espn_123')
    expect(program.start).toBe(start)
    expect(program.end - program.start).toBe(180 * 60_000)
  })

  it('titles the program "Away at Home" using team short names when available', () => {
    const game = makeGame({
      network: 'ESPN',
      away: { abbr: 'SF', shortName: 'Giants', color: null, altColor: null, logo: null, score: null, record: null },
      home: { abbr: 'LAD', shortName: 'Dodgers', color: null, altColor: null, logo: null, score: null, record: null },
    })

    const [program] = gamePrograms([game])

    expect(program.title).toBe('Giants at Dodgers')
  })

  it('falls back to teamAway/teamHome when away/home TeamInfo is absent', () => {
    const game = makeGame({ network: 'ESPN', teamAway: 'Giants', teamHome: 'Dodgers' })

    const [program] = gamePrograms([game])

    expect(program.title).toBe('Giants at Dodgers')
  })

  it('uses headline for the subtitle when present, falling back to statusDetail', () => {
    const withHeadline = gamePrograms([makeGame({ network: 'ESPN', headline: 'NLCS - Game 1', statusDetail: 'Q3' })])
    expect(withHeadline[0].subtitle).toBe('NLCS - Game 1')

    const withoutHeadline = gamePrograms([makeGame({ network: 'ESPN', statusDetail: 'Final' })])
    expect(withoutHeadline[0].subtitle).toBe('Final')
  })

  it('excludes games whose network does not canonicalize to a channel', () => {
    // 'Live HD USA' is entirely quality/region stopwords — canonicalChannel
    // has nothing left to build a name from, so it returns null.
    expect(gamePrograms([makeGame({ network: 'Live HD USA' })])).toEqual([])
  })

  it('excludes games with no network at all', () => {
    expect(gamePrograms([makeGame({})])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// tvmazePrograms
// ---------------------------------------------------------------------------

function makeEpisode(overrides: Partial<TvmazeEpisode> = {}): TvmazeEpisode {
  return {
    airstamp: '2026-09-28T20:00:00+00:00',
    runtime: 30,
    name: 'Pilot',
    show: { name: 'Some Show', network: { name: 'NBC' } },
    ...overrides,
  }
}

describe('tvmazePrograms', () => {
  it('defaults to 60 minutes when runtime is null', () => {
    const [program] = tvmazePrograms([makeEpisode({ runtime: null })])
    expect(program.end - program.start).toBe(60 * 60_000)
  })

  it('uses show.network.name to resolve the channel', () => {
    const [program] = tvmazePrograms([makeEpisode({ show: { name: 'Show', network: { name: 'ESPN' } } })])
    expect(program.channelId).toBe('ch:espn')
  })

  it('falls back to show.webChannel.name when network is absent', () => {
    const [program] = tvmazePrograms([
      makeEpisode({ show: { name: 'Show', network: null, webChannel: { name: 'NFL Network' } } }),
    ])
    expect(program.channelId).toBe('ch:nflnetwork')
  })

  it('excludes episodes with neither network nor webChannel', () => {
    expect(tvmazePrograms([makeEpisode({ show: { name: 'Show', network: null, webChannel: null } })])).toEqual([])
  })

  it('excludes episodes whose network does not canonicalize', () => {
    // Same reasoning as gamePrograms' equivalent test: an all-stopword label
    // canonicalizes to null.
    expect(
      tvmazePrograms([makeEpisode({ show: { name: 'Show', network: { name: 'Live HD USA' } } })])
    ).toEqual([])
  })

  it('sets title to show.name and subtitle to the episode name when it differs', () => {
    const [program] = tvmazePrograms([makeEpisode({ name: 'Episode Ten', show: { name: 'Some Show', network: { name: 'NBC' } } })])
    expect(program.title).toBe('Some Show')
    expect(program.subtitle).toBe('Episode Ten')
  })

  it('omits the subtitle when the episode name equals the show name', () => {
    const [program] = tvmazePrograms([makeEpisode({ name: 'Some Show', show: { name: 'Some Show', network: { name: 'NBC' } } })])
    expect(program.subtitle).toBeUndefined()
  })

  it('marks the program kind as show with no gameId', () => {
    const [program] = tvmazePrograms([makeEpisode({})])
    expect(program.kind).toBe('show')
    expect(program.gameId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mergePrograms
// ---------------------------------------------------------------------------

describe('mergePrograms', () => {
  it('drops a show overlapping a game on the same channel, keeps a show on another channel', () => {
    const game: GuideProgram = {
      channelId: 'ch:nbc',
      title: 'Giants at Dodgers',
      start: 1000,
      end: 1000 + 180 * 60_000,
      kind: 'game',
      gameId: 'espn_123',
    }
    const overlappingShow: GuideProgram = {
      channelId: 'ch:nbc',
      title: 'Nightly News',
      start: 1500,
      end: 1500 + 60 * 60_000,
      kind: 'show',
    }
    const otherChannelShow: GuideProgram = {
      channelId: 'ch:espn',
      title: 'SportsCenter',
      start: 1500,
      end: 1500 + 60 * 60_000,
      kind: 'show',
    }

    const merged = mergePrograms([game], [overlappingShow, otherChannelShow])

    expect(merged).toHaveLength(2)
    expect(merged.some((p) => p.title === 'Nightly News')).toBe(false)
    expect(merged.some((p) => p.title === 'SportsCenter')).toBe(true)
  })

  it('keeps a same-channel show that does not overlap the game', () => {
    const game: GuideProgram = {
      channelId: 'ch:nbc',
      title: 'Game',
      start: 1000,
      end: 2000,
      kind: 'game',
      gameId: 'espn_123',
    }
    const laterShow: GuideProgram = {
      channelId: 'ch:nbc',
      title: 'Later Show',
      start: 2000,
      end: 3000,
      kind: 'show',
    }

    const merged = mergePrograms([game], [laterShow])
    expect(merged.some((p) => p.title === 'Later Show')).toBe(true)
  })

  it('sorts by channel then by start time', () => {
    const a: GuideProgram = { channelId: 'ch:espn', title: 'A', start: 200, end: 300, kind: 'show' }
    const b: GuideProgram = { channelId: 'ch:espn', title: 'B', start: 100, end: 200, kind: 'show' }
    const c: GuideProgram = { channelId: 'ch:cnn', title: 'C', start: 500, end: 600, kind: 'show' }

    const merged = mergePrograms([], [a, b, c])

    expect(merged.map((p) => p.title)).toEqual(['C', 'B', 'A'])
  })
})

// ---------------------------------------------------------------------------
// resolveKnownChannelId
// ---------------------------------------------------------------------------

describe('resolveKnownChannelId', () => {
  it('resolves a "channel"-suffixed id to the known id with that suffix stripped', () => {
    const known = new Set(['ch:foxnews'])
    expect(resolveKnownChannelId('ch:foxnewschannel', known)).toBe('ch:foxnews')
  })

  it('resolves a bare id to the known id with a "network" suffix added', () => {
    const known = new Set(['ch:foxbusinessnetwork'])
    expect(resolveKnownChannelId('ch:foxbusiness', known)).toBe('ch:foxbusinessnetwork')
  })

  it('prefers an exact match over any suffix-tolerant one', () => {
    const known = new Set(['ch:foxnews', 'ch:foxnewschannel'])
    expect(resolveKnownChannelId('ch:foxnewschannel', known)).toBe('ch:foxnewschannel')
  })

  it('returns null when no exact or suffix-tolerant match exists', () => {
    const known = new Set(['ch:cnn'])
    expect(resolveKnownChannelId('ch:foxnewschannel', known)).toBeNull()
  })

  it('tolerates the "tv" suffix in either direction', () => {
    const known = new Set(['ch:nba'])
    expect(resolveKnownChannelId('ch:nbatv', known)).toBe('ch:nba')

    const known2 = new Set(['ch:nbatv'])
    expect(resolveKnownChannelId('ch:nba', known2)).toBe('ch:nbatv')
  })
})

// ---------------------------------------------------------------------------
// fetchTvmaze
// ---------------------------------------------------------------------------

describe('fetchTvmaze', () => {
  it('fetches each date and flattens the results', async () => {
    const episode = makeEpisode({})
    const fetchFn = jest.fn(async () => ({
      ok: true,
      json: async () => [episode],
    })) as unknown as typeof fetch

    const episodes = await fetchTvmaze(['2026-09-28', '2026-09-29'], fetchFn)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(episodes).toEqual([episode, episode])
  })

  it('uses AbortSignal.timeout(5000) per request', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch

    await fetchTvmaze(['2026-09-28'], fetchFn)

    const init = (fetchFn as jest.Mock).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('builds the expected TVmaze URL for a date', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch

    await fetchTvmaze(['2026-09-28'], fetchFn)

    const url = (fetchFn as jest.Mock).mock.calls[0][0] as string
    expect(url).toBe('https://api.tvmaze.com/schedule?country=US&date=2026-09-28')
  })

  it('yields [] for a request that rejects, without throwing', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const episodes = await fetchTvmaze(['2026-09-28'], fetchFn)
    expect(episodes).toEqual([])
  })

  it('yields [] for a non-ok response', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch

    const episodes = await fetchTvmaze(['2026-09-28'], fetchFn)
    expect(episodes).toEqual([])
  })

  it('one date failing does not affect another date succeeding', async () => {
    const episode = makeEpisode({})
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('2026-09-28')) throw new Error('boom')
      return { ok: true, json: async () => [episode] }
    }) as unknown as typeof fetch

    const episodes = await fetchTvmaze(['2026-09-28', '2026-09-29'], fetchFn)
    expect(episodes).toEqual([episode])
  })
})

// ---------------------------------------------------------------------------
// buildGuide
// ---------------------------------------------------------------------------

describe('buildGuide', () => {
  it('keeps a game program only when its channel is known', () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const game = makeGame({ network: 'NBC', startTime: now })
    const channels = [makeChannel('ch:nbc', 'NBC')]

    const guide = buildGuide({ channels, games: [game], fetchFn: jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch, now })

    return guide.then((g) => {
      expect(g.programs).toHaveLength(1)
      expect(g.programs[0].channelId).toBe('ch:nbc')
    })
  })

  it('resolves a program onto a suffix-tolerant known channel and keeps it', async () => {
    // TVmaze reports "Fox News Channel" -> ch:foxnewschannel, but the only
    // known channel (as a source actually spells it) is ch:foxnews. Without
    // suffix-tolerant resolution this show would be dropped as "unknown
    // channel" even though it's clearly the same network.
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels = [makeChannel('ch:foxnews', 'Fox News')]
    const episode = makeEpisode({
      airstamp: new Date(now).toISOString(),
      show: { name: 'Some Show', network: { name: 'Fox News Channel' } },
    })
    // buildGuide fetches both today and tomorrow — only "today" should
    // return the episode, or it'd land twice (once per date requested).
    const todayStr = new Date(now).toISOString().slice(0, 10)
    const fetchFn = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes(todayStr) ? [episode] : []),
    })) as unknown as typeof fetch

    const guide = await buildGuide({ channels, games: [], fetchFn, now })

    expect(guide.programs).toHaveLength(1)
    expect(guide.programs[0].channelId).toBe('ch:foxnews')
  })

  it('excludes programs for unknown channels', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const game = makeGame({ network: 'NBC', startTime: now })
    const channels: Channel[] = [] // NBC is not a known channel

    const guide = await buildGuide({
      channels,
      games: [game],
      fetchFn: jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch,
      now,
    })

    expect(guide.programs).toEqual([])
  })

  it('yields a guide with games only when fetchTvmaze fails', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const game = makeGame({ network: 'NBC', startTime: now })
    const channels = [makeChannel('ch:nbc', 'NBC')]
    const failingFetch = jest.fn(async () => {
      throw new Error('tvmaze is down')
    }) as unknown as typeof fetch

    const guide = await buildGuide({ channels, games: [game], fetchFn: failingFetch, now })

    expect(guide.programs).toHaveLength(1)
    expect(guide.programs[0].kind).toBe('game')
  })

  it('drops programs entirely outside [now-1h, now+24h]', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const tooEarly = makeGame({
      gameId: 'espn_early',
      network: 'NBC',
      startTime: now - 5 * 60 * 60_000, // ended long before the window
    })
    const tooLate = makeGame({
      gameId: 'espn_late',
      network: 'NBC',
      startTime: now + 30 * 60 * 60_000, // starts after the window
    })
    const inWindow = makeGame({
      gameId: 'espn_now',
      network: 'NBC',
      startTime: now,
    })
    const channels = [makeChannel('ch:nbc', 'NBC')]

    const guide = await buildGuide({
      channels,
      games: [tooEarly, tooLate, inWindow],
      fetchFn: jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch,
      now,
    })

    expect(guide.programs.map((p) => p.gameId)).toEqual(['espn_now'])
  })

  it('sets generatedAt to now and passes channels through unchanged', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels = [makeChannel('ch:nbc', 'NBC')]

    const guide = await buildGuide({
      channels,
      games: [],
      fetchFn: jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch,
      now,
    })

    expect(guide.generatedAt).toBe(now)
    expect(guide.channels).toEqual(channels)
  })

  it('requests TVmaze for today and tomorrow in local date form', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels: Channel[] = []
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch

    await buildGuide({ channels, games: [], fetchFn, now })

    const today = new Date(now)
    const tomorrow = new Date(now + 24 * 60 * 60_000)
    const fmt = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    const urls = (fetchFn as jest.Mock).mock.calls.map((c) => c[0] as string)
    expect(urls).toEqual([
      `https://api.tvmaze.com/schedule?country=US&date=${fmt(today)}`,
      `https://api.tvmaze.com/schedule?country=US&date=${fmt(tomorrow)}`,
    ])
  })
})

// ---------------------------------------------------------------------------
// fetchTvmazeCached (I2)
// ---------------------------------------------------------------------------

describe('fetchTvmazeCached', () => {
  beforeEach(() => {
    __resetTvmazeCacheForTests()
  })

  it('does not refetch a date within the 30-minute TTL', async () => {
    const episode = makeEpisode({})
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [episode] })) as unknown as typeof fetch
    const now = Date.parse('2026-09-28T12:00:00Z')

    const first = await fetchTvmazeCached(['2026-09-28'], fetchFn, now)
    const second = await fetchTvmazeCached(['2026-09-28'], fetchFn, now + 10 * 60_000) // +10min, within TTL

    expect(first).toEqual([episode])
    expect(second).toEqual([episode])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refetches a date once the 30-minute TTL has elapsed', async () => {
    const episode = makeEpisode({})
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [episode] })) as unknown as typeof fetch
    const now = Date.parse('2026-09-28T12:00:00Z')

    await fetchTvmazeCached(['2026-09-28'], fetchFn, now)
    await fetchTvmazeCached(['2026-09-28'], fetchFn, now + 31 * 60_000) // past the 30-min TTL

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed fetch as success — the next call retries it', async () => {
    const episode = makeEpisode({})
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [episode] }) as unknown as typeof fetch
    const now = Date.parse('2026-09-28T12:00:00Z')

    const first = await fetchTvmazeCached(['2026-09-28'], fetchFn, now)
    // Still within the TTL window of the (failed) first call — but since a
    // failure isn't cached, this must retry rather than reuse [].
    const second = await fetchTvmazeCached(['2026-09-28'], fetchFn, now + 1000)

    expect(first).toEqual([])
    expect(second).toEqual([episode])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('caches each date independently', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
    const now = Date.parse('2026-09-28T12:00:00Z')

    await fetchTvmazeCached(['2026-09-28'], fetchFn, now)
    await fetchTvmazeCached(['2026-09-29'], fetchFn, now) // a different date — not covered by the first's cache

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Shared "latest guide" store (I2): buildAndStoreGuide / getOrBuildGuide /
// getLatestGuide — the single place index.ts and ipc/handlers.ts both read
// and write through, so 'get-guide' serves what the refresh loop already
// built instead of independently rebuilding.
// ---------------------------------------------------------------------------

describe('latest guide store', () => {
  beforeEach(() => {
    __resetLatestGuideForTests()
    __resetTvmazeCacheForTests()
  })

  it('getLatestGuide is null before anything has been built', () => {
    expect(getLatestGuide()).toBeNull()
  })

  it('buildAndStoreGuide records its result as the latest', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels = [makeChannel('ch:nbc', 'NBC')]
    const fetchFn = jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch

    const guide = await buildAndStoreGuide({ channels, games: [], fetchFn, now })

    expect(getLatestGuide()).toBe(guide)
  })

  it('getOrBuildGuide builds only when nothing has been built yet', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels = [makeChannel('ch:nbc', 'NBC')]
    const fetchFn = jest.fn(async () => ({ ok: false, json: async () => [] })) as unknown as typeof fetch

    const built = await getOrBuildGuide({ channels, games: [], fetchFn, now })
    expect(getLatestGuide()).toBe(built)

    // A second call with completely different deps must NOT rebuild — it
    // should hand back the exact same guide already stored.
    const second = await getOrBuildGuide({ channels: [], games: [], fetchFn, now: now + 1 })
    expect(second).toBe(built)
  })

  it('buildAndStoreGuide uses the cached TVmaze fetch, not a fresh one each call', async () => {
    const now = Date.parse('2026-09-28T12:00:00Z')
    const channels = [makeChannel('ch:nbc', 'NBC')]
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch

    await buildAndStoreGuide({ channels, games: [], fetchFn, now })
    await buildAndStoreGuide({ channels, games: [], fetchFn, now: now + 60_000 }) // well within the TTL

    // 2 dates (today + tomorrow) fetched once, not once per call.
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
