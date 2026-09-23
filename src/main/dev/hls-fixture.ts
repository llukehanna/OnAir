import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Failure-injection HLS fixture
//
// A local HLS origin that can be commanded to fail in the specific ways real
// sources fail. The failover layer exists to survive these failures, and before this
// fixture the only way to observe one was to wait for a live stream to
// misbehave — which is why "is it my failover?" went unanswered for a year.
//
// Two deliberate design choices:
//
// 1. The live edge does NOT advance on a wall-clock timer. Tests call advance()
//    explicitly, so a slow CI machine cannot change the outcome. Pass
//    autoAdvance for manual/dev use where real-time behavior is wanted.
//
// 2. Segment bodies are synthetic MPEG-TS null packets by default. That is
//    sufficient for every HTTP-level assertion (status codes, manifest
//    polling, media-sequence advancement, failover orchestration in main).
//    Assertions that need a real decoder — readyState, currentTime advancing
//    across a swap — must run in a browser tier and should pass a real segment
//    via the segmentBody option.
// ---------------------------------------------------------------------------

export type FailureMode =
  /** Normal live stream. */
  | 'healthy'
  /** Live edge keeps moving, segment bodies never arrive — starves the buffer. */
  | 'stall'
  /** Segments 403. Models a CDN token that has expired mid-playback. */
  | 'segment-403'
  /** Media playlist 404. Models a source that is simply gone. */
  | 'manifest-404'
  /** HTTP 200 everywhere, but the media sequence never moves. Off-air slate. */
  | 'off-air'
  /** Segments arrive later than realtime. */
  | 'slow'

export interface HlsFixtureOptions {
  /** Advertised duration of each segment, in seconds. Default 2. */
  segmentDurationSec?: number
  /** Number of segments in the live window. Default 6. */
  windowSize?: number
  /** Delay applied to segments in 'slow' mode, in ms. Default 3000. */
  slowDelayMs?: number
  /** Emit #EXT-X-PROGRAM-DATE-TIME. Needed by continuity tests. Default false. */
  programDateTime?: boolean
  /** ISO timestamp for the first segment when programDateTime is on. */
  startDate?: string
  /** Body served for segment requests. Defaults to synthetic TS null packets. */
  segmentBody?: Buffer
  /**
   * Directory of real seg{N}.ts files. Set this when the assertion needs a
   * decoder — readyState and currentTime cannot be exercised by synthetic null
   * packets. Segments cycle by sequence, so a short set serves a live window.
   */
  mediaDir?: string
  /** Advance the live edge on a real timer. For manual use, not tests. */
  autoAdvance?: boolean
}

export interface RecordedRequest {
  path: string
  status: number
  mode: FailureMode
  at: number
}

export interface HlsFixture {
  port: number
  masterUrl: string
  mediaUrl: string
  /** URL for the segment at an absolute sequence number. */
  segmentUrl(sequence: number): string
  /** Current media sequence of the first segment in the window. */
  readonly mediaSequence: number
  /** Roll the live edge forward. No-op in off-air mode. */
  advance(count?: number): void
  setMode(mode: FailureMode): void
  getMode(): FailureMode
  requests: RecordedRequest[]
  close(): Promise<void>
}

/** 188-byte MPEG-TS null packet: sync byte, PID 0x1FFF, then padding. */
function tsNullPacket(): Buffer {
  const packet = Buffer.alloc(188, 0xff)
  packet[0] = 0x47
  packet[1] = 0x1f
  packet[2] = 0xff
  packet[3] = 0x10
  return packet
}

const DEFAULT_SEGMENT_BODY = Buffer.concat(Array.from({ length: 16 }, tsNullPacket))

export async function startHlsFixture(options: HlsFixtureOptions = {}): Promise<HlsFixture> {
  const segmentDurationSec = options.segmentDurationSec ?? 2
  const windowSize = options.windowSize ?? 6
  const slowDelayMs = options.slowDelayMs ?? 3000
  const emitPdt = options.programDateTime ?? false
  const startDateMs = Date.parse(options.startDate ?? '2026-01-01T00:00:00.000Z')
  const segmentBody = options.segmentBody ?? DEFAULT_SEGMENT_BODY

  // Real segments are read once at startup — a disk hit per segment request
  // would add latency the timing assertions would then have to tolerate.
  const realSegments: Buffer[] = []
  if (options.mediaDir) {
    for (let i = 0; ; i++) {
      const file = path.join(options.mediaDir, `seg${i}.ts`)
      if (!fs.existsSync(file)) break
      realSegments.push(fs.readFileSync(file))
    }
    if (realSegments.length === 0) {
      throw new Error(`hls fixture: no seg{N}.ts files found in ${options.mediaDir}`)
    }
  }

  /** Cycles the available segments so a short set can serve a rolling window. */
  function bodyForSequence(sequence: number): Buffer {
    if (realSegments.length === 0) return segmentBody
    const index = ((sequence % realSegments.length) + realSegments.length) % realSegments.length
    return realSegments[index]
  }

  function sequenceFromPath(requestPath: string): number {
    const match = /segment(\d+)\.ts/.exec(requestPath)
    return match ? Number(match[1]) : 0
  }

  let mode: FailureMode = 'healthy'
  let mediaSequence = 0
  const requests: RecordedRequest[] = []

  // Responses deliberately left unanswered by 'stall'. Held so they can be
  // released on mode change and destroyed on close — otherwise the server
  // cannot shut down and Jest reports an open handle.
  const heldResponses = new Set<http.ServerResponse>()

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  function buildMasterPlaylist(): string {
    return [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720',
      'media.m3u8',
      '',
    ].join('\n')
  }

  function buildMediaPlaylist(): string {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:' + segmentDurationSec,
      '#EXT-X-MEDIA-SEQUENCE:' + mediaSequence,
    ]

    for (let i = 0; i < windowSize; i++) {
      const sequence = mediaSequence + i
      if (emitPdt) {
        const at = new Date(startDateMs + sequence * segmentDurationSec * 1000)
        lines.push('#EXT-X-PROGRAM-DATE-TIME:' + at.toISOString())
      }
      lines.push('#EXTINF:' + segmentDurationSec.toFixed(3) + ',')
      lines.push('segment' + sequence + '.ts')
    }

    // No #EXT-X-ENDLIST — the absence is what marks the playlist as live.
    lines.push('')
    return lines.join('\n')
  }

  function record(path: string, status: number): void {
    requests.push({ path, status, mode, at: Date.now() })
  }

  function send(res: http.ServerResponse, path: string, status: number, contentType: string, body: string | Buffer): void {
    record(path, status)
    res.writeHead(status, {
      'content-type': contentType,
      'cache-control': 'no-store',
      // The app injects this in production via session.webRequest
      // .onHeadersReceived; without it hls.js cannot fetch cross-origin, which
      // is every CDN. Emitting it here mirrors the real renderer environment.
      'access-control-allow-origin': '*',
    })
    res.end(body)
  }

  const server = http.createServer((req, res) => {
    const path = req.url ?? '/'

    if (path.startsWith('/master.m3u8')) {
      send(res, path, 200, 'application/vnd.apple.mpegurl', buildMasterPlaylist())
      return
    }

    if (path.startsWith('/media.m3u8')) {
      if (mode === 'manifest-404') {
        send(res, path, 404, 'text/plain', 'not found')
        return
      }
      send(res, path, 200, 'application/vnd.apple.mpegurl', buildMediaPlaylist())
      return
    }

    if (path.includes('.ts')) {
      if (mode === 'segment-403') {
        send(res, path, 403, 'text/plain', 'forbidden')
        return
      }

      if (mode === 'stall') {
        // Record the attempt, then never answer. This is what starves the
        // player's buffer and produces BUFFER_STALL_ERROR rather than an
        // error event, which is the distinction failover has to handle.
        record(path, 0)
        heldResponses.add(res)
        res.on('close', () => heldResponses.delete(res))
        return
      }

      const body = bodyForSequence(sequenceFromPath(path))

      if (mode === 'slow') {
        const timer = setTimeout(() => {
          pendingTimers.delete(timer)
          if (!res.writableEnded) {
            send(res, path, 200, 'video/mp2t', body)
          }
        }, slowDelayMs)
        pendingTimers.add(timer)
        return
      }

      send(res, path, 200, 'video/mp2t', body)
      return
    }

    send(res, path, 404, 'text/plain', 'not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`

  let autoAdvanceTimer: ReturnType<typeof setInterval> | null = null
  if (options.autoAdvance) {
    autoAdvanceTimer = setInterval(() => {
      if (mode !== 'off-air') mediaSequence += 1
    }, segmentDurationSec * 1000)
    autoAdvanceTimer.unref()
  }

  function releaseHeldResponses(): void {
    for (const res of heldResponses) {
      if (!res.writableEnded) {
        record('release', 200)
        res.writeHead(200, { 'content-type': 'video/mp2t' })
        res.end(bodyForSequence(0))
      }
    }
    heldResponses.clear()
  }

  return {
    port,
    masterUrl: `${origin}/master.m3u8`,
    mediaUrl: `${origin}/media.m3u8`,
    segmentUrl: (sequence: number) => `${origin}/segment${sequence}.ts`,
    get mediaSequence() {
      return mediaSequence
    },
    advance(count = 1) {
      // Off-air means the origin has stopped producing. Refusing to advance
      // here is the whole point of the mode: HTTP stays healthy while the
      // stream is dead.
      if (mode === 'off-air') return
      mediaSequence += count
    },
    setMode(next: FailureMode) {
      const previous = mode
      mode = next
      // Leaving stall must not abandon the sockets it parked.
      if (previous === 'stall' && next !== 'stall') releaseHeldResponses()
    },
    getMode() {
      return mode
    },
    requests,
    async close() {
      if (autoAdvanceTimer) clearInterval(autoAdvanceTimer)
      for (const timer of pendingTimers) clearTimeout(timer)
      pendingTimers.clear()
      for (const res of heldResponses) res.destroy()
      heldResponses.clear()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
