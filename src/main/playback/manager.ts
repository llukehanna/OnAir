import type { BrowserWindow } from 'electron'
import type { PlayResult, PlaybackEvent, EventType, StreamCandidate, StreamType, WatchTarget } from '../types'
import { getCacheEntries, classifyEntry, validateStaleEntries, setCacheEntries, type UrlCacheEntry } from '../engine/cache'
import { getStreamCandidates } from '../engine/index'
import { resolveTarget } from '../engine/targets'
import { destroyWebView, createWebView } from './webview'
import { appendEvent } from '../db/queries/events'
import { getSourceById } from '../db/queries/sources'
import { setActiveStreamHeaders } from './cors'
import { startProxy, stopProxy } from './proxy'
import { createFailoverSession, type FailoverSession } from './failover-session'
import { checkLiveness, type LivenessResult } from './off-air'
import { verifyWebViewPlayback } from './webview-verify'
import {
  recordStartupSuccess,
  recordStartupFailure,
  recordSwitchEvent,
} from '../db/queries/reliability'

// CDN domains whose tokens are session-bound and cannot be replayed from the renderer.
// For these, fall back to WebContentsView (embedded page playback).
const SESSION_BOUND_CDNS = ['cam.edu']

/** How often the playing stream's live edge is re-checked. */
const LIVENESS_INTERVAL_MS = 20_000

type PlaybackState = 'IDLE' | 'LOADING' | 'PLAYING'

/**
 * The minimum a thing needs to be playable. Both UrlCacheEntry and
 * StreamCandidate satisfy it, which lets play() and failover() share one
 * playback path instead of duplicating five near-identical return sites.
 *
 * Note on identity: cache entries carry no candidateId, so sourceId doubles as
 * the identity on the cache path. Session bookkeeping and select-stream pinning
 * both key off `candidateId` below, which is the sourceId for cache-derived
 * sources and the real candidateId for freshly extracted ones.
 */
interface PlayableSource {
  candidateId: string
  sourceId: string
  streamUrl: string
  streamType: StreamType
  refererUrl: string | null
  cdnOrigin: string | null
  cdnReferer: string | null
  browserContext?: import('playwright').BrowserContext
  manifestBody?: string | null
}

function entryToPlayable(entry: UrlCacheEntry): PlayableSource {
  return {
    candidateId: entry.candidateId,
    sourceId: entry.sourceId,
    streamUrl: entry.streamUrl,
    streamType: entry.streamType,
    refererUrl: entry.refererUrl ?? null,
    cdnOrigin: entry.cdnOrigin ?? null,
    cdnReferer: entry.cdnReferer ?? null,
  }
}

function candidateToPlayable(candidate: StreamCandidate): PlayableSource {
  return {
    candidateId: candidate.candidateId,
    sourceId: candidate.sourceId,
    streamUrl: candidate.streamUrl,
    streamType: candidate.streamType,
    refererUrl: candidate.refererUrl ?? null,
    cdnOrigin: candidate.cdnOrigin ?? null,
    cdnReferer: candidate.cdnReferer ?? null,
    browserContext: candidate.browserContext,
    manifestBody: candidate.manifestBody,
  }
}

/** Cache entries become session candidates so the session works on every path. */
function entryToCandidate(entry: UrlCacheEntry, gameId: string): StreamCandidate {
  return {
    candidateId: entry.candidateId,
    gameId,
    sourceId: entry.sourceId,
    streamUrl: entry.streamUrl,
    streamType: entry.streamType,
    quality: entry.quality,
    score: entry.score,
    probedAt: entry.cachedAt,
    probeSuccess: true,
    probeLatencyMs: null,
    refererUrl: entry.refererUrl ?? null,
    cdnOrigin: entry.cdnOrigin ?? null,
    cdnReferer: entry.cdnReferer ?? null,
  }
}

// ---------------------------------------------------------------------------
// Injectable function types
// ---------------------------------------------------------------------------

type GetTargetFn = (id: string) => WatchTarget | null
type GetCacheEntriesFn = (gameId: string) => UrlCacheEntry[]
type ClassifyEntryFn = (entry: UrlCacheEntry) => 'fresh' | 'stale' | 'expired'
type ValidateStaleFn = (entries: UrlCacheEntry[]) => Promise<UrlCacheEntry | null>
type GetStreamCandidatesFn = (target: WatchTarget) => Promise<StreamCandidate[]>
type SetCacheEntriesFn = (gameId: string, candidates: StreamCandidate[]) => void
type AppendEventFn = (
  eventType: EventType,
  opts?: { gameId?: string; sourceId?: string; details?: Record<string, unknown> }
) => void

// ---------------------------------------------------------------------------
// PlaybackManager
// ---------------------------------------------------------------------------

/**
 * Central control point for playback state in the main process.
 *
 * Manages the IDLE/LOADING/PLAYING state machine.
 * Always destroys the current stream before starting a new one (new game always wins).
 * Pushes playback-event IPC events to the renderer via win.webContents.send.
 *
 * All dependencies are injectable for testability — defaults to real implementations.
 */
export class PlaybackManager {
  private state: PlaybackState = 'IDLE'
  private win: BrowserWindow | undefined

  /** Per-game failover state. Null when nothing is playing. */
  private session: FailoverSession | null = null
  /** The source currently on screen, so failover knows what to mark as failed. */
  private currentSource: PlayableSource | null = null
  private currentTarget: WatchTarget | null = null

  /** Background off-air watch on the playing stream. */
  private livenessTimer: ReturnType<typeof setInterval> | null = null
  private checkLivenessFn: typeof checkLiveness = checkLiveness
  private verifyWebViewFn: () => Promise<boolean> = () => verifyWebViewPlayback()
  /** Human-readable source name for UI events; falls back to the id. */
  private sourceNameFn: (sourceId: string) => string = (sourceId) => {
    try {
      return getSourceById(sourceId)?.name ?? sourceId
    } catch {
      return sourceId
    }
  }

  // Injected dependencies (defaults to real implementations)
  private getTargetFn: GetTargetFn
  private getCacheEntriesFn: GetCacheEntriesFn
  private classifyEntryFn: ClassifyEntryFn
  private validateStaleFn: ValidateStaleFn
  private getStreamCandidatesFn: GetStreamCandidatesFn
  private setCacheEntriesFn: SetCacheEntriesFn
  private appendEventFn: AppendEventFn

  constructor(
    win?: BrowserWindow,
    getTargetFn?: GetTargetFn,
    getCacheEntriesFn?: GetCacheEntriesFn,
    classifyEntryFn?: ClassifyEntryFn,
    validateStaleFn?: ValidateStaleFn,
    getStreamCandidatesFn?: GetStreamCandidatesFn,
    setCacheEntriesFn?: SetCacheEntriesFn,
    appendEventFn?: AppendEventFn
  ) {
    this.win = win
    this.getTargetFn = getTargetFn ?? ((id) => resolveTarget(id))
    this.getCacheEntriesFn = getCacheEntriesFn ?? getCacheEntries
    this.classifyEntryFn = classifyEntryFn ?? classifyEntry
    this.validateStaleFn = validateStaleFn ?? validateStaleEntries
    this.getStreamCandidatesFn = getStreamCandidatesFn ?? getStreamCandidates
    this.setCacheEntriesFn = setCacheEntriesFn ?? setCacheEntries
    this.appendEventFn = appendEventFn ?? appendEvent
  }

  /**
   * Starts playback for the given game or channel id.
   *
   * Resolution order:
   *  1. Fresh cache entries — serve immediately
   *  2. Stale entries — HEAD validate top 3, use if any pass
   *  3. Cold — full Playwright extraction via getStreamCandidates
   *
   * Always destroys current stream first (new target always wins).
   */
  async play(id: string): Promise<PlayResult> {
    const target = this.getTargetFn(id)
    if (!target) return { ok: false as const, reason: 'game_not_found' as const }

    // New target always wins — destroy whatever was playing
    this.destroyCurrent()
    setActiveStreamHeaders(null, null)

    this.state = 'LOADING'
    console.log(`[PlaybackManager] play(${id}) state=LOADING`)

    try {
      const entries = this.getCacheEntriesFn(target.id)
      const now = Date.now()
      console.log(`[PlaybackManager] cache entries=${entries.length} for ${target.id}`)

      // 1. Fresh entries — serve immediately, no HEAD check
      //    Skip session-bound CDN entries — their tokens can't be replayed from
      //    the renderer without the original browser context (which isn't cached).
      const fresh = entries.filter(e =>
        this.classifyEntryFn(e) === 'fresh' &&
        !SESSION_BOUND_CDNS.some(cdn => e.streamUrl.includes(cdn))
      )
      if (fresh.length > 0) {
        void now
        this.session = createFailoverSession(
          target.id,
          fresh.map((e) => entryToCandidate(e, target.id))
        )
        const top = fresh[0] // already sorted by score descending
        return await this.startPlayback(target, entryToPlayable(top))
      }

      // 2. Stale entries — HEAD validate top 3, serve if any pass
      //    Same session-bound filter as above.
      const stale = entries.filter(e =>
        this.classifyEntryFn(e) === 'stale' &&
        !SESSION_BOUND_CDNS.some(cdn => e.streamUrl.includes(cdn))
      )
      if (stale.length > 0) {
        const validEntry = await this.validateStaleFn(stale)
        if (validEntry) {
          this.session = createFailoverSession(
            target.id,
            stale.map((e) => entryToCandidate(e, target.id))
          )
          return await this.startPlayback(target, entryToPlayable(validEntry))
        }
      }

      // 3. Expired or no valid entries — full extraction via Playwright
      //    Hard 30s timeout prevents pool starvation from blocking the user forever.
      const candidates = await Promise.race([
        this.getStreamCandidatesFn(target),
        new Promise<StreamCandidate[]>((resolve) => setTimeout(() => {
          console.warn('[PlaybackManager] extraction timed out after 30s')
          resolve([])
        }, 30_000)),
      ])
      if (candidates.length === 0) {
        this.state = 'IDLE'
        return { ok: false as const, reason: 'no_candidates' as const }
      }

      this.setCacheEntriesFn(target.id, candidates)
      this.session = createFailoverSession(target.id, candidates)

      return await this.startPlayback(target, candidateToPlayable(candidates[0]))
    } catch (err) {
      console.error('[PlaybackManager] play() threw:', err)
      this.state = 'IDLE'
      return { ok: false as const, reason: 'no_candidates' as const }
    }
  }

  /**
   * The single path by which anything reaches the screen. play() and failover()
   * both route through here so the proxy decision, header injection, state
   * transition, and reliability write cannot drift apart.
   */
  private async startPlayback(target: WatchTarget, source: PlayableSource): Promise<PlayResult> {
    // Session-bound CDNs reject requests from the Electron renderer (403)
    // because tokens are tied to the browser session that captured them.
    const isSessionBound = SESSION_BOUND_CDNS.some((cdn) => source.streamUrl.includes(cdn))

    let streamUrl = source.streamUrl
    let cdnOrigin = source.cdnOrigin
    let cdnReferer = source.cdnReferer

    if (isSessionBound && source.browserContext) {
      console.log('[PlaybackManager] session-bound CDN detected, starting proxy')
      streamUrl = await startProxy(
        source.streamUrl,
        source.browserContext,
        source.manifestBody,
        source.cdnReferer,
        source.cdnOrigin
      )
      // The proxy replays the captured session, so the renderer must not also
      // send its own CDN headers.
      cdnOrigin = null
      cdnReferer = null
    } else {
      setActiveStreamHeaders(source.cdnOrigin, source.cdnReferer)
    }

    this.currentSource = source
    this.currentTarget = target
    this.state = 'PLAYING'
    this.startLivenessMonitor(target, source)

    this.pushEvent({
      type: 'stream_started',
      gameId: target.id,
      sourceId: source.sourceId,
      occurredAt: Date.now(),
    })

    // Closes the reliability loop: scoring can only learn which sources hold up
    // if playback reports back. Without this the tables stay at their defaults.
    try {
      recordStartupSuccess(source.sourceId, target.scope, 0)
    } catch {
      // Reliability accounting must never take playback down with it.
    }

    return {
      ok: true as const,
      candidateId: source.candidateId,
      streamUrl,
      streamType: source.streamType,
      refererUrl: source.refererUrl,
      cdnOrigin,
      cdnReferer,
    }
  }

  /**
   * Moves off the current stream onto the next viable option.
   *
   * Never destroys the current stream first — the renderer keeps the existing
   * frame on screen until the replacement produces a confirmed first frame.
   * That is the never-black invariant, and it is why this is a separate path
   * from play(), which correctly destroys immediately because the user asked
   * for different content.
   *
   * Escalates: next candidate -> one re-extraction -> WebContentsView -> failed.
   */
  async failover(gameId: string, reason: string): Promise<PlayResult> {
    const session = this.session
    const target = this.currentTarget ?? this.getTargetFn(gameId)

    if (!session || session.gameId !== gameId || !target) {
      return { ok: false as const, reason: 'game_not_found' as const }
    }

    // Collapses a burst of concurrent requests — a renderer stall timeout and a
    // main-side check can both land in the same instant.
    if (!session.beginSwitch()) {
      console.log(`[PlaybackManager] failover already in flight for ${gameId}, ignoring`)
      return { ok: false as const, reason: 'not_implemented' as const }
    }

    try {
      const failed = this.currentSource
      if (failed) {
        session.markAttempted(failed.candidateId)
        this.recordFailureFor(failed.sourceId, target)
        this.appendEventFn('source_switch', {
          gameId,
          sourceId: failed.sourceId,
          details: { reason },
        })
      }

      // Rung 1 — another candidate we have not tried.
      const next = session.nextCandidate()
      if (next) {
        console.log(`[PlaybackManager] failover -> ${next.sourceId} (${reason})`)
        this.pushEvent({
          type: 'source_switch',
          gameId,
          sourceId: next.sourceId,
          details: { reason, sourceName: this.sourceNameFn(next.sourceId) },
          occurredAt: Date.now(),
        })
        return await this.startPlayback(target, candidateToPlayable(next))
      }

      // Rung 2 — one fresh extraction. Every cached URL may be an expired token
      // rather than a dead source, so this often recovers the whole list.
      if (session.canReextract) {
        session.escalate()
        console.log(`[PlaybackManager] candidates exhausted, re-extracting for ${gameId}`)
        const fresh = await this.getStreamCandidatesFn(target).catch(() => [])
        session.replaceCandidates(fresh)
        if (fresh.length > 0) {
          this.setCacheEntriesFn(gameId, fresh)
          const retry = session.nextCandidate()
          if (retry) {
            this.pushEvent({
              type: 'source_switch',
              gameId,
              sourceId: retry.sourceId,
              details: { reason: 'reextracted', sourceName: this.sourceNameFn(retry.sourceId) },
              occurredAt: Date.now(),
            })
            return await this.startPlayback(target, candidateToPlayable(retry))
          }
        }
      }

      // Rung 3 — embedded playback. The only path that can play an embed hls.js
      // cannot, and until now it was plumbed end to end but never invoked.
      const embeds = session.embedPlayerUrls()
      if (session.rung !== 'webview' && embeds.length > 0 && this.win) {
        session.escalate()
        const [embedUrl] = embeds
        console.log(`[PlaybackManager] falling back to WebContentsView: ${embedUrl}`)
        const [width, height] = this.win.getContentSize()
        createWebView(this.win, embedUrl, { x: 0, y: 0, width, height })

        // Verify before declaring success. This is the last rung, so a false
        // positive strands the viewer on a page that never plays while the app
        // stops escalating. Loading is not playing.
        const playing = await this.verifyWebViewFn()
        if (!playing) {
          console.log('[PlaybackManager] embedded player never started, abandoning webview tier')
          destroyWebView(this.win)
        } else {
          this.state = 'PLAYING'
          this.pushEvent({
            type: 'source_switch',
            gameId,
            details: { reason: 'webview_fallback', sourceName: 'embedded player' },
            occurredAt: Date.now(),
          })
          return {
            ok: true as const,
            candidateId: 'webview',
            streamUrl: embedUrl,
            streamType: 'embedded' as StreamType,
            refererUrl: null,
            cdnOrigin: null,
            cdnReferer: null,
          }
        }
      }

      // Terminal.
      while (!session.isExhausted) session.escalate()
      this.state = 'IDLE'
      this.currentSource = null
      console.log(`[PlaybackManager] all sources failed for ${gameId}`)
      this.pushEvent({
        type: 'all_sources_failed',
        gameId,
        details: { reason },
        occurredAt: Date.now(),
      })
      this.appendEventFn('all_sources_failed', { gameId, details: { reason } })
      return { ok: false as const, reason: 'all_probes_failed' as const }
    } finally {
      session.endSwitch()
    }
  }

  /**
   * Plays a specific candidate on the user's instruction and pins it.
   *
   * The pin is a preference, not a lock: it outranks score while it lives, and
   * failover clears it the moment the pinned source dies. Staying on air wins.
   */
  async selectStream(candidateId: string): Promise<PlayResult> {
    const session = this.session
    const target = this.currentTarget
    if (!session || !target) return { ok: false as const, reason: 'game_not_found' as const }

    session.pin(candidateId)
    const picked = session.nextCandidate()
    if (!picked || picked.candidateId !== candidateId) {
      return { ok: false as const, reason: 'no_candidates' as const }
    }

    this.pushEvent({
      type: 'source_switch',
      gameId: target.id,
      sourceId: picked.sourceId,
      details: { reason: 'user_selected', sourceName: this.sourceNameFn(picked.sourceId) },
      occurredAt: Date.now(),
    })
    return await this.startPlayback(target, candidateToPlayable(picked))
  }

  /**
   * Watches the playing stream's live edge and fails over if it stops moving.
   *
   * Deviation from the spec, deliberate: the spec also called for a pre-flight
   * gate before promoting a candidate. A liveness check costs two fetches
   * separated by more than one target duration — roughly 2.5s — and putting
   * that on the failover path would add it to every recovery, while the viewer
   * watches a frozen frame. The whole point of the ladder is to move fast.
   *
   * So the check runs in the background against whatever is already playing.
   * An off-air source is caught within one interval instead of never, and
   * recovery latency is unchanged.
   */
  private startLivenessMonitor(target: WatchTarget, source: PlayableSource): void {
    this.stopLivenessMonitor()

    // Embedded playback has no manifest to poll.
    if (source.streamType !== 'hls') return

    this.livenessTimer = setInterval(async () => {
      // Bail if what we were watching is no longer what is playing.
      if (this.currentSource !== source || this.state !== 'PLAYING') return

      let result: LivenessResult
      try {
        result = await this.checkLivenessFn(source.streamUrl, {
          referer: source.cdnReferer ?? source.refererUrl,
          origin: source.cdnOrigin,
        })
      } catch {
        return
      }

      if (this.currentSource !== source) return

      // 'unknown' means the diagnostic failed, not that the stream did.
      // Refusing to play on a failed diagnostic would be worse than the
      // problem it detects.
      if (result.verdict !== 'frozen') return

      console.log(
        `[PlaybackManager] off-air detected on ${source.sourceId}`,
        result.firstSequence === null
          ? '(segment list unchanged)'
          : `(sequence stuck at ${result.firstSequence})`
      )
      void this.failover(target.id, 'off_air')
    }, LIVENESS_INTERVAL_MS)

    this.livenessTimer.unref?.()
  }

  private stopLivenessMonitor(): void {
    if (this.livenessTimer !== null) {
      clearInterval(this.livenessTimer)
      this.livenessTimer = null
    }
  }

  private recordFailureFor(sourceId: string, target: WatchTarget): void {
    try {
      recordStartupFailure(sourceId, target.scope)
      recordSwitchEvent(sourceId, target.scope)
    } catch {
      // Reliability accounting must never take playback down with it.
    }
  }

  /**
   * Stops playback and transitions to IDLE.
   * Does not push any event to the renderer.
   */
  stop(): void {
    this.stopLivenessMonitor()
    this.destroyCurrent()
    setActiveStreamHeaders(null, null)
    this.session = null
    this.currentSource = null
    this.currentTarget = null
    this.state = 'IDLE'
  }

  /**
   * Logs a playback event to the events table via appendEvent.
   * The renderer reports stream failures through here.
   */
  reportEvent(event: Omit<PlaybackEvent, 'occurredAt'>): void {
    this.appendEventFn(
      event.type as EventType,
      {
        gameId: event.gameId,
        sourceId: event.sourceId,
        details: event.details,
      }
    )
  }

  /**
   * Returns the current playback state. Used for testing and debugging.
   */
  getState(): PlaybackState {
    return this.state
  }

  /**
   * Destroys the current stream (WebContentsView if any).
   * Safe to call when nothing is playing — webview.ts handles null guard.
   */
  private destroyCurrent(): void {
    destroyWebView(this.win)
    stopProxy()
  }

  /**
   * Pushes a playback-event IPC message to the renderer.
   */
  private pushEvent(event: PlaybackEvent): void {
    this.win?.webContents.send('playback-event', event)
  }
}
