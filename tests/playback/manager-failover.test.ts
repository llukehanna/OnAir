import { PlaybackManager } from '../../src/main/playback/manager'
import type { Game, PlaybackEvent, StreamCandidate } from '../../src/main/types'
import type { UrlCacheEntry } from '../../src/main/engine/cache'

// ---------------------------------------------------------------------------
// The escalation ladder, exercised through the manager rather than the session.
//
// The session's own suite proves the bookkeeping. These tests prove the wiring:
// that each rung is actually reached, that the ladder never tears down the
// current stream before it has a replacement, and that terminal state is only
// declared after every rung has been spent.
// ---------------------------------------------------------------------------

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

function makeCandidate(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    candidateId: 'cand-1',
    gameId: 'game-1',
    sourceId: 'src-1',
    streamUrl: 'https://cdn.example.com/1.m3u8',
    streamType: 'hls',
    quality: '720p',
    score: 0.9,
    probedAt: FIXED_START_TIME,
    probeSuccess: true,
    probeLatencyMs: 100,
    refererUrl: null,
    cdnOrigin: null,
    cdnReferer: null,
    ...overrides,
  }
}

function makeMockWin() {
  const sendCalls: Array<[string, unknown]> = []
  const win = {
    webContents: {
      send: (channel: string, payload: unknown) => sendCalls.push([channel, payload]),
    },
    getContentSize: () => [1280, 800],
    contentView: { addChildView: () => {}, removeChildView: () => {} },
    _sendCalls: sendCalls,
  }
  return win as unknown as import('electron').BrowserWindow & { _sendCalls: typeof sendCalls }
}

function pushedEvents(win: ReturnType<typeof makeMockWin>): PlaybackEvent[] {
  return win._sendCalls
    .filter(([channel]) => channel === 'playback-event')
    .map(([, payload]) => payload as PlaybackEvent)
}

/**
 * Builds a manager whose cold path yields the given candidates, with no cache
 * entries so play() always goes through extraction.
 */
function makeManager(
  candidates: StreamCandidate[],
  opts: {
    win?: ReturnType<typeof makeMockWin>
    onExtract?: () => Promise<StreamCandidate[]>
    appendEvent?: jest.Mock
  } = {}
) {
  const extract = opts.onExtract ?? (async () => candidates)
  const mgr = new PlaybackManager(
    opts.win,
    () => makeGame(),
    () => [],
    () => 'expired',
    async () => null,
    extract,
    () => {},
    (opts.appendEvent ?? jest.fn()) as never
  )
  return mgr
}

const THREE = [
  makeCandidate({ candidateId: 'a', sourceId: 'sa', score: 0.9, streamUrl: 'https://cdn/a.m3u8' }),
  makeCandidate({ candidateId: 'b', sourceId: 'sb', score: 0.7, streamUrl: 'https://cdn/b.m3u8' }),
  makeCandidate({ candidateId: 'c', sourceId: 'sc', score: 0.5, streamUrl: 'https://cdn/c.m3u8' }),
]

describe('PlaybackManager failover ladder', () => {
  // -- rung 1: next candidate ----------------------------------------------

  it('moves to the next candidate on failover', async () => {
    const mgr = makeManager(THREE)
    const first = await mgr.play('game-1')
    expect(first.ok && first.candidateId).toBe('a')

    const second = await mgr.failover('game-1', 'stall')
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.candidateId).toBe('b')
  })

  it('walks down the ranked list across successive failovers', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    const seen: string[] = []
    for (let i = 0; i < 2; i++) {
      const r = await mgr.failover('game-1', 'stall')
      if (r.ok) seen.push(r.candidateId)
    }
    expect(seen).toEqual(['b', 'c'])
  })

  it('stays PLAYING across a failover rather than dropping to IDLE', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    expect(mgr.getState()).toBe('PLAYING')
  })

  it('emits a source_switch event naming the incoming source', async () => {
    const win = makeMockWin()
    const mgr = makeManager(THREE, { win })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    const switches = pushedEvents(win).filter((e) => e.type === 'source_switch')
    expect(switches).toHaveLength(1)
    expect(switches[0].sourceId).toBe('sb')
  })

  it('records the failure reason against the outgoing source', async () => {
    const appendEvent = jest.fn()
    const mgr = makeManager(THREE, { appendEvent })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'token_expired')
    expect(appendEvent).toHaveBeenCalledWith(
      'source_switch',
      expect.objectContaining({ sourceId: 'sa', details: { reason: 'token_expired' } })
    )
  })

  // -- the in-flight lock ---------------------------------------------------

  it('collapses concurrent failover requests into a single switch', async () => {
    const win = makeMockWin()
    const mgr = makeManager(THREE, { win })
    await mgr.play('game-1')

    await Promise.all([
      mgr.failover('game-1', 'stall'),
      mgr.failover('game-1', 'stall'),
      mgr.failover('game-1', 'stall'),
    ])

    const switches = pushedEvents(win).filter((e) => e.type === 'source_switch')
    expect(switches).toHaveLength(1)
  })

  it('does not skip candidates when concurrent requests arrive', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    await Promise.all([mgr.failover('game-1', 'stall'), mgr.failover('game-1', 'stall')])
    // Only one switch happened, so 'c' must still be available.
    const next = await mgr.failover('game-1', 'stall')
    expect(next.ok && next.candidateId).toBe('c')
  })

  it('accepts a new failover once the previous one completes', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    const again = await mgr.failover('game-1', 'stall')
    expect(again.ok).toBe(true)
  })

  // -- rung 2: re-extraction ------------------------------------------------

  it('re-extracts once when the candidate list is spent', async () => {
    let calls = 0
    const mgr = makeManager([], {
      onExtract: async () => {
        calls++
        return calls === 1
          ? [makeCandidate({ candidateId: 'only', sourceId: 'so' })]
          : [makeCandidate({ candidateId: 'fresh', sourceId: 'sf', streamUrl: 'https://cdn/f.m3u8' })]
      },
    })
    await mgr.play('game-1')
    const result = await mgr.failover('game-1', 'stall')
    expect(calls).toBe(2)
    expect(result.ok && result.candidateId).toBe('fresh')
  })

  it('reports the re-extraction as the reason for that switch', async () => {
    const win = makeMockWin()
    let calls = 0
    const mgr = makeManager([], {
      win,
      onExtract: async () => {
        calls++
        return calls === 1
          ? [makeCandidate({ candidateId: 'only', sourceId: 'so' })]
          : [makeCandidate({ candidateId: 'fresh', sourceId: 'sf' })]
      },
    })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    const switches = pushedEvents(win).filter((e) => e.type === 'source_switch')
    expect(switches.some((e) => e.details?.reason === 'reextracted')).toBe(true)
  })

  it('does not re-extract a second time', async () => {
    let calls = 0
    const mgr = makeManager([], {
      onExtract: async () => {
        calls++
        return calls === 1 ? [makeCandidate({ candidateId: 'only', sourceId: 'so' })] : []
      },
    })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall') // spends the re-extraction
    const before = calls
    await mgr.failover('game-1', 'stall')
    expect(calls).toBe(before)
  })

  it('survives a re-extraction that throws', async () => {
    let calls = 0
    const mgr = makeManager([], {
      onExtract: async () => {
        calls++
        if (calls === 1) return [makeCandidate({ candidateId: 'only', sourceId: 'so' })]
        throw new Error('pool exhausted')
      },
    })
    await mgr.play('game-1')
    const result = await mgr.failover('game-1', 'stall')
    expect(result.ok).toBe(false)
  })

  // -- terminal state -------------------------------------------------------

  it('declares all_sources_failed only after every rung is spent', async () => {
    const win = makeMockWin()
    let calls = 0
    const mgr = makeManager([], {
      win,
      onExtract: async () => {
        calls++
        return calls === 1 ? [makeCandidate({ candidateId: 'only', sourceId: 'so' })] : []
      },
    })
    await mgr.play('game-1')

    const result = await mgr.failover('game-1', 'stall')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('all_probes_failed')
    expect(pushedEvents(win).some((e) => e.type === 'all_sources_failed')).toBe(true)
  })

  it('does not emit all_sources_failed while candidates remain', async () => {
    const win = makeMockWin()
    const mgr = makeManager(THREE, { win })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    expect(pushedEvents(win).some((e) => e.type === 'all_sources_failed')).toBe(false)
  })

  it('writes the terminal state to the events table', async () => {
    const appendEvent = jest.fn()
    let calls = 0
    const mgr = makeManager([], {
      appendEvent,
      onExtract: async () => {
        calls++
        return calls === 1 ? [makeCandidate({ candidateId: 'only', sourceId: 'so' })] : []
      },
    })
    await mgr.play('game-1')
    await mgr.failover('game-1', 'stall')
    expect(appendEvent).toHaveBeenCalledWith('all_sources_failed', expect.anything())
  })

  // -- guards ---------------------------------------------------------------

  it('refuses to failover a game that is not the one playing', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    const result = await mgr.failover('other-game', 'stall')
    expect(result.ok).toBe(false)
  })

  it('refuses to failover when nothing is playing', async () => {
    const mgr = makeManager(THREE)
    const result = await mgr.failover('game-1', 'stall')
    expect(result.ok).toBe(false)
  })

  it('clears session state on stop so a stale session cannot be resumed', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    mgr.stop()
    const result = await mgr.failover('game-1', 'stall')
    expect(result.ok).toBe(false)
  })

  // -- manual selection -----------------------------------------------------

  it('selectStream plays the requested candidate', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    const result = await mgr.selectStream('c')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.candidateId).toBe('c')
  })

  it('selectStream marks the choice as user-driven', async () => {
    const win = makeMockWin()
    const mgr = makeManager(THREE, { win })
    await mgr.play('game-1')
    await mgr.selectStream('c')
    const switches = pushedEvents(win).filter((e) => e.type === 'source_switch')
    expect(switches.some((e) => e.details?.reason === 'user_selected')).toBe(true)
  })

  it('a pinned source that dies is failed over, not honored', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    await mgr.selectStream('c')
    const after = await mgr.failover('game-1', 'stall')
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.candidateId).not.toBe('c')
  })

  it('selectStream rejects an unknown candidate', async () => {
    const mgr = makeManager(THREE)
    await mgr.play('game-1')
    const result = await mgr.selectStream('nope')
    expect(result.ok).toBe(false)
  })

  it('selectStream refuses when nothing is playing', async () => {
    const mgr = makeManager(THREE)
    const result = await mgr.selectStream('a')
    expect(result.ok).toBe(false)
  })
})
