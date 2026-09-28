import { isChannelId, resolveTarget } from '../../src/main/engine/targets'
import type { Game, Channel } from '../../src/main/types'

const GAME: Game = {
  gameId: 'nba_test001',
  league: 'nba',
  teamHome: 'Los Angeles Lakers',
  teamAway: 'Golden State Warriors',
  startTime: Date.now(),
  status: 'LIVE',
}

const CHANNEL: Channel = {
  channelId: 'ch:espn',
  name: 'ESPN',
  category: 'sports',
  sourceCount: 2,
  lastSeenAt: Date.now(),
}

describe('isChannelId', () => {
  it('is true for a ch: prefixed id', () => {
    expect(isChannelId('ch:espn')).toBe(true)
  })

  it('is false for a game id', () => {
    expect(isChannelId('nba_test001')).toBe(false)
  })
})

describe('resolveTarget', () => {
  it("returns the channel target for a 'ch:espn' id via the injected getChannel", () => {
    const getChannel = jest.fn().mockReturnValue(CHANNEL)
    const getGame = jest.fn()

    const target = resolveTarget('ch:espn', { getGame, getChannel })

    expect(getChannel).toHaveBeenCalledWith('ch:espn')
    expect(getGame).not.toHaveBeenCalled()
    expect(target).toEqual({ kind: 'channel', id: 'ch:espn', scope: 'channel', channel: CHANNEL })
  })

  it('returns the game target for a game id', () => {
    const getGame = jest.fn().mockReturnValue(GAME)
    const getChannel = jest.fn()

    const target = resolveTarget('nba_test001', { getGame, getChannel })

    expect(getGame).toHaveBeenCalledWith('nba_test001')
    expect(getChannel).not.toHaveBeenCalled()
    expect(target).toEqual({ kind: 'game', id: 'nba_test001', scope: 'nba', game: GAME })
  })

  it('returns null for an unknown game id', () => {
    const target = resolveTarget('nba_unknown', { getGame: () => null, getChannel: () => null })
    expect(target).toBeNull()
  })

  it('returns null for an unknown channel id', () => {
    const target = resolveTarget('ch:unknown', { getGame: () => null, getChannel: () => null })
    expect(target).toBeNull()
  })
})
