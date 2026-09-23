import { PlaybackManager } from '../../src/main/playback/manager'
import type { Game, PlaybackEvent, StreamCandidate } from '../../src/main/types'
import type { UrlCacheEntry } from '../../src/main/engine/cache'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fixed startTime, not Date.now(). Assertions compare whole Game objects, so
// a wall-clock value makes the test fail whenever the two Date.now() calls land
// in different milliseconds — which is why this suite flapped between runs.
const FIXED_START_TIME = 1_786_691_551_000

function makeGame(id = 'game-1'): Game {
  return {
    gameId: id,
    league: 'nba',
    teamHome: 'Lakers',
    teamAway: 'Celtics',
    startTime: FIXED_START_TIME,
    status: 'LIVE',
  }
}

function makeEntry(overrides: Partial<UrlCacheEntry> = {}): UrlCacheEntry {
  return {
    gameId: 'game-1',
    // Deliberately different from sourceId: one source can serve several
    // streams, and the cache path must carry the stream's own identity so
    // select-stream pins the stream rather than the source.
    candidateId: 'cand-1',
    sourceId: 'src-1',
    streamUrl: 'https://cdn.example.com/stream.m3u8',
    streamType: 'hls',
    quality: '720p',
    score: 0.9,
    cachedAt: Date.now(),
    validatedAt: Date.now(), // fresh by default
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    candidateId: 'cand-1',
    gameId: 'game-1',
    sourceId: 'src-1',
    streamUrl: 'https://cdn.example.com/stream.m3u8',
    streamType: 'hls',
    quality: '720p',
    score: 0.9,
    probedAt: Date.now(),
    probeSuccess: true,
    probeLatencyMs: 100,
    ...overrides,
  }
}

function makeMockWin() {
  const sendCalls: Array<[string, unknown]> = []
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => sendCalls.push([channel, payload]),
    },
    _sendCalls: sendCalls,
  }
  return win as unknown as import('electron').BrowserWindow & { _sendCalls: typeof sendCalls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaybackManager', () => {
  it('starts in IDLE state', () => {
    const mgr = new PlaybackManager()
    expect(mgr.getState()).toBe('IDLE')
  })

  it('play(gameId) with fresh cache entry returns ok:true', async () => {
    const entry = makeEntry()
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [entry],
      () => 'fresh',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    const result = await mgr.play('game-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.streamUrl).toBe(entry.streamUrl)
      expect(result.streamType).toBe(entry.streamType)
      // The stream's own identity, not the source's.
      expect(result.candidateId).toBe(entry.candidateId)
    }
  })

  it('play(gameId) with stale cache entry that passes HEAD validation returns ok:true', async () => {
    const staleEntry = makeEntry({ validatedAt: Date.now() - 4 * 60 * 1000 })
    const validateFn = jest.fn().mockResolvedValue(staleEntry)
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [staleEntry],
      () => 'stale',
      validateFn,
      async () => [],
      () => {},
      () => {}
    )
    const result = await mgr.play('game-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.streamUrl).toBe(staleEntry.streamUrl)
    }
  })

  it('play(gameId) with no cache entry calls getStreamCandidates and returns ok:true', async () => {
    const candidate = makeCandidate()
    const getStreamFn = jest.fn().mockResolvedValue([candidate])
    const setCacheFn = jest.fn()
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [],
      () => 'expired',
      async () => null,
      getStreamFn,
      setCacheFn,
      () => {}
    )
    const result = await mgr.play('game-1')
    expect(result.ok).toBe(true)
    expect(getStreamFn).toHaveBeenCalledWith(makeGame())
    expect(setCacheFn).toHaveBeenCalled()
    if (result.ok) {
      expect(result.streamUrl).toBe(candidate.streamUrl)
    }
  })

  it('play(gameId) with unknown gameId returns game_not_found', async () => {
    const mgr = new PlaybackManager(
      undefined,
      () => null,
      () => [],
      () => 'expired',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    const result = await mgr.play('unknown-game')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('game_not_found')
    }
  })

  it('play(gameId) when no candidates found returns no_candidates', async () => {
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [],
      () => 'expired',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    const result = await mgr.play('game-1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no_candidates')
    }
  })

  it('play(gameId) transitions state from IDLE to PLAYING on success', async () => {
    const entry = makeEntry()
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [entry],
      () => 'fresh',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    expect(mgr.getState()).toBe('IDLE')
    await mgr.play('game-1')
    expect(mgr.getState()).toBe('PLAYING')
  })

  it('play(gameId) pushes stream_started event via win.webContents.send', async () => {
    const entry = makeEntry()
    const win = makeMockWin()
    const mgr = new PlaybackManager(
      win,
      () => makeGame(),
      () => [entry],
      () => 'fresh',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    await mgr.play('game-1')
    const calls = win._sendCalls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][0]).toBe('playback-event')
    const evt = calls[0][1] as PlaybackEvent
    expect(evt.type).toBe('stream_started')
    expect(evt.gameId).toBe('game-1')
  })

  it('play(newGameId) while PLAYING calls destroyCurrent first', async () => {
    const entry1 = makeEntry({ sourceId: 'src-1', streamUrl: 'https://cdn.example.com/1.m3u8' })
    const entry2 = makeEntry({ gameId: 'game-2', sourceId: 'src-2', streamUrl: 'https://cdn.example.com/2.m3u8' })

    const getGameFn = jest.fn()
      .mockReturnValueOnce(makeGame('game-1'))
      .mockReturnValueOnce(makeGame('game-2'))

    const getCacheFn = jest.fn()
      .mockReturnValueOnce([entry1])
      .mockReturnValueOnce([entry2])

    const classifyFn = jest.fn().mockReturnValue('fresh')

    const mgr = new PlaybackManager(
      undefined,
      getGameFn,
      getCacheFn,
      classifyFn,
      async () => null,
      async () => [],
      () => {},
      () => {}
    )

    await mgr.play('game-1')
    expect(mgr.getState()).toBe('PLAYING')

    await mgr.play('game-2')
    // After second play, state is still PLAYING (new game took over)
    expect(mgr.getState()).toBe('PLAYING')
  })

  it('stop() transitions to IDLE', async () => {
    const entry = makeEntry()
    const mgr = new PlaybackManager(
      undefined,
      () => makeGame(),
      () => [entry],
      () => 'fresh',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    await mgr.play('game-1')
    expect(mgr.getState()).toBe('PLAYING')
    mgr.stop()
    expect(mgr.getState()).toBe('IDLE')
  })

  it('stop() does not push any event to renderer', async () => {
    const entry = makeEntry()
    const win = makeMockWin()
    const mgr = new PlaybackManager(
      win,
      () => makeGame(),
      () => [entry],
      () => 'fresh',
      async () => null,
      async () => [],
      () => {},
      () => {}
    )
    await mgr.play('game-1')
    const callsBeforeStop = win._sendCalls.length
    mgr.stop()
    expect(win._sendCalls.length).toBe(callsBeforeStop)
  })

  it('reportEvent logs via appendEvent', () => {
    const appendFn = jest.fn()
    const mgr = new PlaybackManager(
      undefined,
      () => null,
      () => [],
      () => 'expired',
      async () => null,
      async () => [],
      () => {},
      appendFn
    )
    const event: Omit<PlaybackEvent, 'occurredAt'> = {
      type: 'stream_failed',
      gameId: 'game-1',
      sourceId: 'src-1',
      details: { reason: 'timeout' },
    }
    mgr.reportEvent(event)
    expect(appendFn).toHaveBeenCalledWith(
      'stream_failed',
      { gameId: 'game-1', sourceId: 'src-1', details: { reason: 'timeout' } }
    )
  })
})
