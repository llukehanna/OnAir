import { PlaywrightPool } from '../../src/main/adapters/pool'
import { StubAdapter } from '../../src/main/adapters/sources/stub'
import { createMockBrowserFactory } from '../helpers/playwright-mock'
import type { Game } from '../../src/main/types'

const mockGame: Game = {
  gameId: 'test-game-1',
  league: 'nba',
  teamHome: 'Lakers',
  teamAway: 'Celtics',
  startTime: Date.now(),
  status: 'LIVE',
}

describe('StubAdapter', () => {
  let adapter: StubAdapter
  let pool: PlaywrightPool

  beforeEach(() => {
    adapter = new StubAdapter()
    pool = new PlaywrightPool(createMockBrowserFactory())
  })

  afterEach(async () => {
    await pool.shutdown()
  })

  it('has sourceId "stub"', () => {
    expect(adapter.sourceId).toBe('stub')
  })

  it('has name "Stub Adapter"', () => {
    expect(adapter.name).toBe('Stub Adapter')
  })

  it('has a baseUrl', () => {
    expect(adapter.baseUrl).toBe('https://example.invalid')
  })

  it('has classification "event_first"', () => {
    expect(adapter.classification).toBe('event_first')
  })

  it('supports all 4 leagues', () => {
    expect(adapter.supportedLeagues).toEqual(['nba', 'nfl', 'mlb', 'cbb', 'cfb'])
  })

  it('has extractionMethod "html_parse"', () => {
    expect(adapter.extractionMethod).toBe('html_parse')
  })

  it('has confidenceWeight of 0', () => {
    expect(adapter.confidenceWeight).toBe(0)
  })

  it('getCandidateStreams returns empty array', async () => {
    const results = await adapter.getCandidateStreams(mockGame, pool)
    expect(results).toEqual([])
  })

  it('getSourceHealth returns "unknown"', async () => {
    const health = await adapter.getSourceHealth(pool)
    expect(health).toBe('unknown')
  })
})
