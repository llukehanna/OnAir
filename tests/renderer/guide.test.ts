import {
  currentProgram,
  filterChannels,
  floorToSlot,
  guideWindow,
  liveChannelIds,
  monogram,
  nextProgram,
  onNow,
  placeBlock,
  progressOf,
  slotTicks,
  sortChannels,
  xFor,
  type ChannelLike,
} from '../../src/renderer/src/lib/guide'

// ---------------------------------------------------------------------------
// The guide grid is pure arithmetic over timestamps: a window that starts on
// the half hour, blocks clipped to it, and a channel order that puts live
// games first. Getting any of these wrong shows up as misaligned blocks or a
// channel that can't be found, so they are pinned here.
// ---------------------------------------------------------------------------

const MIN = 60_000
const HOUR = 60 * MIN

function at(h: number, m: number): number {
  return new Date(2026, 8, 28, h, m, 0, 0).getTime()
}

describe('guide window', () => {
  it('floors to the current half hour', () => {
    expect(floorToSlot(at(20, 17) + 42_000)).toBe(at(20, 0))
    expect(floorToSlot(at(20, 30))).toBe(at(20, 30))
    expect(floorToSlot(at(20, 59))).toBe(at(20, 30))
  })

  it('spans twelve hours of 30-minute ticks', () => {
    const win = guideWindow(at(20, 17))
    expect(win).toEqual({ start: at(20, 0), end: at(20, 0) + 12 * HOUR })
    const ticks = slotTicks(win)
    expect(ticks).toHaveLength(24)
    expect(ticks[1] - ticks[0]).toBe(30 * MIN)
  })

  it('maps time to 240px per hour', () => {
    expect(xFor(at(21, 30), at(20, 0))).toBe(360)
  })
})

describe('placeBlock', () => {
  const win = { start: at(20, 0), end: at(20, 0) + 12 * HOUR }

  it('clips a program that began before the window', () => {
    expect(placeBlock({ channelId: 'a', start: at(19, 0), end: at(21, 0) }, win)).toEqual({
      left: 0,
      width: 240,
      clippedStart: true,
    })
  })

  it('drops programs outside the window', () => {
    expect(placeBlock({ channelId: 'a', start: at(18, 0), end: at(20, 0) }, win)).toBeNull()
    expect(placeBlock({ channelId: 'a', start: win.end, end: win.end + HOUR }, win)).toBeNull()
  })
})

describe('current and next program', () => {
  const programs = [
    { channelId: 'a', start: at(19, 0), end: at(21, 0), title: 'long' },
    { channelId: 'a', start: at(20, 0), end: at(20, 30), title: 'overlap' },
    { channelId: 'a', start: at(21, 0), end: at(22, 0), title: 'later' },
    { channelId: 'b', start: at(20, 0), end: at(23, 0), title: 'other channel' },
  ]

  it('prefers the most recently started program when listings overlap', () => {
    expect(currentProgram(programs, 'a', at(20, 10))?.title).toBe('overlap')
    expect(currentProgram(programs, 'a', at(20, 45))?.title).toBe('long')
  })

  it('treats end as exclusive', () => {
    expect(currentProgram(programs, 'a', at(21, 0))?.title).toBe('later')
  })

  it('finds the next program on the same channel only', () => {
    expect(nextProgram(programs, 'a', at(20, 10))?.title).toBe('later')
    expect(nextProgram(programs, 'b', at(20, 10))).toBeUndefined()
  })

  it('keeps a live game on now past its listed end', () => {
    const withGame = [
      ...programs,
      { channelId: 'c', start: at(17, 0), end: at(20, 0), title: 'overtime', gameId: 'g1' },
      { channelId: 'c', start: at(20, 0), end: at(23, 0), title: 'after the game' },
    ]
    expect(onNow(withGame, 'c', at(20, 10), new Set(['g1']))?.title).toBe('overtime')
    expect(onNow(withGame, 'c', at(20, 10), new Set())?.title).toBe('after the game')
    expect([...liveChannelIds(withGame, new Set(['g1']))]).toEqual(['c'])
  })

  it('reports progress through a program', () => {
    expect(progressOf(programs[0], at(20, 0))).toBe(0.5)
    expect(progressOf(programs[0], at(23, 0))).toBe(1)
  })
})

describe('channel order and filtering', () => {
  const channels: ChannelLike[] = [
    { channelId: 'ch:hgtv', name: 'HGTV', category: 'entertainment' },
    { channelId: 'ch:cnn', name: 'CNN', category: 'news' },
    { channelId: 'ch:espn2', name: 'ESPN2', category: 'sports' },
    { channelId: 'ch:espn', name: 'ESPN', category: 'sports' },
    { channelId: 'ch:tnt', name: 'TNT', category: 'entertainment' },
  ]

  it('puts channels with a live game first, then category, then name', () => {
    const order = sortChannels(channels, new Set(['ch:tnt'])).map((c) => c.name)
    expect(order).toEqual(['TNT', 'ESPN', 'ESPN2', 'CNN', 'HGTV'])
  })

  it('filters by category and a case-insensitive name search', () => {
    expect(filterChannels(channels, 'sports', '').map((c) => c.name)).toEqual(['ESPN2', 'ESPN'])
    expect(filterChannels(channels, 'all', ' espn ').map((c) => c.name)).toEqual(['ESPN2', 'ESPN'])
    expect(filterChannels(channels, 'news', 'espn')).toEqual([])
  })
})

describe('monogram', () => {
  it('keeps short all-caps names and takes initials otherwise', () => {
    expect(monogram('ESPN')).toBe('ESPN')
    expect(monogram('ESPN2')).toBe('ESPN2')
    expect(monogram('A&E')).toBe('A&E')
    expect(monogram('USA Network')).toBe('USA')
    expect(monogram('Fox News')).toBe('FN')
    expect(monogram('Fixture One')).toBe('FO')
    expect(monogram('Bravo')).toBe('BR')
  })
})
