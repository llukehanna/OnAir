import { useRef, useState, useCallback, useEffect } from 'react'
import Hls from 'hls.js'
import { createStallMachine, type StallMachine } from '../playback/stall-machine'
import { classifyHlsError, type HlsErrorLike } from '../playback/error-classify'
import { computeContinuityTarget, type FragmentLike } from '../playback/continuity'

type PlayerState = 'idle' | 'loading' | 'playing' | 'error'

export interface UsePlaybackReturn {
  // Physical video element refs — bind these in JSX: <video ref={video0Ref} />
  video0Ref: React.MutableRefObject<HTMLVideoElement | null>
  video1Ref: React.MutableRefObject<HTMLVideoElement | null>
  // React state driving which slot is visible. True = slot 0 is active.
  slot0IsActive: boolean
  playerState: PlayerState
  errorReason: string | null
  /** The candidate currently on screen; null until the first frame. */
  activeCandidateId: string | null
  /** Seconds behind the live edge, as estimated by hls.js; null when unknown. */
  liveLatency: number | null
  playGame: (gameId: string) => Promise<void>
  /** Manually switch to a specific candidate. Resolves true once it is loading. */
  selectCandidate: (candidateId: string) => Promise<boolean>
  stopPlayback: () => void
}

export function usePlayback(): UsePlaybackReturn {
  // Physical refs — React assigns these via ref={video0Ref} / ref={video1Ref} in JSX.
  // These are always set as long as PlayerScreen is mounted.
  const video0Ref = useRef<HTMLVideoElement | null>(null)
  const video1Ref = useRef<HTMLVideoElement | null>(null)

  // Ref version of slot0IsActive for synchronous reads inside async playGame.
  // A plain ref never has stale-closure issues in async callbacks.
  const slot0IsActiveRef = useRef(true)

  // State version drives JSX visibility — React controls which video element is shown.
  const [slot0IsActive, setSlot0IsActive] = useState(true)

  const currentHlsRef = useRef<Hls | null>(null)
  const stagingHlsRef = useRef<Hls | null>(null)
  const stagingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playerState, setPlayerState] = useState<PlayerState>('idle')
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)
  const [liveLatency, setLiveLatency] = useState<number | null>(null)
  const currentGameIdRef = useRef<string | null>(null)

  // Cleanup — destroys all hls.js instances, clears timers, resets slot to 0
  const destroyAll = useCallback(() => {
    if (stagingTimerRef.current) {
      clearTimeout(stagingTimerRef.current)
      stagingTimerRef.current = null
    }
    if (stagingHlsRef.current) {
      stagingHlsRef.current.destroy()
      stagingHlsRef.current = null
    }
    if (currentHlsRef.current) {
      currentHlsRef.current.destroy()
      currentHlsRef.current = null
    }
    // A timer armed against the outgoing stream must never fire against the
    // incoming one — that would failover away from a working stream.
    stallMachineRef.current?.reset()
    hasPlayedSuccessfullyRef.current = false
    slot0IsActiveRef.current = true
    setSlot0IsActive(true)
    setActiveCandidateId(null)
    setLiveLatency(null)
  }, [])

  // Swap active and staging slots — updates both the ref (for sync reads) and
  // state (for React rendering). No imperative style.display manipulation needed.
  const swapVideos = useCallback(() => {
    const next = !slot0IsActiveRef.current
    slot0IsActiveRef.current = next
    setSlot0IsActive(next)
  }, [])

  const retryCountRef = useRef(0)

  // Tracks whether the current stream ever produced a frame. This is what
  // separates "the CDN token expired on a working source" from "we were never
  // authorized" — the same 403 with two different correct responses.
  const hasPlayedSuccessfullyRef = useRef(false)

  // Fragment lists for the playing and loading streams. Continuity needs both
  // sides to map a wall-clock instant from one timeline onto the other.
  const currentFragsRef = useRef<FragmentLike[]>([])
  const stagingFragsRef = useRef<FragmentLike[]>([])

  // Reports the failure, then asks main to move to the next viable source.
  // The current stream is deliberately left playing: main hands back a
  // replacement and the swap happens on its first frame, so the viewer keeps
  // the existing picture until there is something better to show.
  const requestFailover = useCallback(
    (gameId: string, reason: string, details?: Record<string, unknown>) => {
      window.onair.reportEvent({ type: 'stream_failed', gameId, reason, details })
      window.onair
        .switchStream(gameId, reason)
        .then((result) => {
          if (currentGameIdRef.current !== gameId) return
          if (result.ok) {
            console.log(`[usePlayback] failover -> ${result.candidateId}`)
            attachStreamRef.current?.(gameId, result)
            return
          }
          // The ladder is spent. Say so honestly rather than spinning.
          if (result.reason === 'all_probes_failed') {
            setPlayerState('error')
            setErrorReason('all_sources_failed')
          }
        })
        .catch(() => {
          if (currentGameIdRef.current !== gameId) return
          setPlayerState('error')
          setErrorReason('failover_failed')
        })
    },
    []
  )

  // Set once playGame is defined; lets failover reuse the same attach path
  // without duplicating the hls.js staging setup.
  const attachStreamRef = useRef<
    ((gameId: string, result: PlayResult & { ok: true }) => void | Promise<void>) | null
  >(null)

  // One machine per hook instance, re-armed per stream via reset().
  const stallMachineRef = useRef<StallMachine | null>(null)
  if (stallMachineRef.current === null) {
    stallMachineRef.current = createStallMachine({
      onStallTimeout: () => {
        const gameId = currentGameIdRef.current
        if (gameId === null) return
        console.log('[usePlayback] stall exceeded threshold — requesting failover')
        requestFailover(gameId, 'stall')
      },
    })
  }

  const playGame = useCallback(async (gameId: string) => {
    // New game always wins — destroy whatever was playing
    destroyAll()
    setPlayerState('loading')
    setErrorReason(null)
    currentGameIdRef.current = gameId
    // Reset retry counter for fresh game clicks (not for auto-retries)
    if (retryCountRef.current === 0 || currentGameIdRef.current !== gameId) {
      retryCountRef.current = 0
    }

    try {
      const result = await window.onair.playGame(gameId)
      console.log('[usePlayback] play result:', JSON.stringify(result).slice(0, 300))

      // Guard: if a newer playGame call happened while we awaited, bail
      if (currentGameIdRef.current !== gameId) return

      if (!result.ok) {
        console.log('[usePlayback] FAILED:', result.reason)
        setPlayerState('error')
        setErrorReason(result.reason)
        return
      }

      await attachStreamRef.current?.(gameId, result)
    } catch {
      if (currentGameIdRef.current !== gameId) return
      setPlayerState('error')
      setErrorReason('ipc_error')
    }
  }, [destroyAll, swapVideos])

  /**
   * Loads a resolved stream onto the staging element and swaps on first frame.
   *
   * Split out from playGame so failover reuses the exact same attach path.
   * Critically, this does NOT tear down the active stream — the swap happens
   * only on FRAG_CHANGED, so the current picture stays up until a replacement
   * is genuinely ready. That is the never-black invariant.
   */
  const attachStream = useCallback(async (gameId: string, result: PlayResult & { ok: true }) => {
    {
      const { streamUrl, streamType, cdnOrigin, cdnReferer, refererUrl } = result
      console.log('[usePlayback] stream:', streamUrl?.slice(0, 80), 'type:', streamType)
      console.log('[usePlayback] CDN headers:', 'origin:', cdnOrigin, 'referer:', cdnReferer, 'page:', refererUrl)

      if (streamType === 'embedded') {
        // WebContentsView handled by main process — renderer just shows playing state
        setActiveCandidateId(result.candidateId)
        setPlayerState('playing')
        return
      }

      // HLS — use hls.js
      if (!Hls.isSupported()) {
        setPlayerState('error')
        setErrorReason('hls_not_supported')
        return
      }

      // Wait for the video element to be available — PlayerScreen may not
      // have mounted yet if playGame was called in the same tick as setScreen.
      let stagingEl: HTMLVideoElement | null = null
      for (let attempt = 0; attempt < 20; attempt++) {
        stagingEl = slot0IsActiveRef.current ? video1Ref.current : video0Ref.current
        if (stagingEl) break
        await new Promise(r => setTimeout(r, 100))
      }
      if (!stagingEl) {
        console.log('[usePlayback] no video element after 2s')
        setPlayerState('error')
        setErrorReason('no_video_element')
        return
      }

      const nextHls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3,
        enableWorker: false, // Disable worker — worker requests bypass webRequest hooks
      })
      stagingHlsRef.current = nextHls

      console.log('[usePlayback] loading HLS source:', streamUrl.slice(0, 80))
      nextHls.loadSource(streamUrl)
      nextHls.attachMedia(stagingEl)

      // On manifest parsed — start playback on staging (hidden)
      nextHls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log('[usePlayback] MANIFEST_PARSED, levels:', data?.levels?.length)
        stagingEl.play().catch(() => {
          // Autoplay blocked — acceptable, user can interact
        })
      })

      // 15-second timeout — if FRAG_CHANGED not received, staging failed.
      // Destroy the staging HLS instance here so a delayed FRAG_CHANGED cannot
      // fire after this timeout and override the error state with a black screen.
      stagingTimerRef.current = setTimeout(() => {
        console.log('[usePlayback] staging timeout reached (15s) — no FRAG_CHANGED received')
        if (currentGameIdRef.current !== gameId) return
        if (stagingHlsRef.current) {
          stagingHlsRef.current.destroy()
          stagingHlsRef.current = null
        }
        setPlayerState('error')
        setErrorReason('staging_timeout')
        window.onair.reportEvent({
          type: 'stream_failed',
          gameId,
          reason: 'staging_timeout',
        })
      }, 15_000)

      // FRAG_CHANGED — fires on every fragment. We only care about the FIRST one
      // to swap staging → active. Subsequent fragments should NOT trigger a swap.
      let swapDone = false
      nextHls.on(Hls.Events.FRAG_CHANGED, () => {
        if (swapDone) return  // Already swapped — ignore subsequent fragments
        if (currentGameIdRef.current !== gameId) return
        swapDone = true

        console.log('[usePlayback] FRAG_CHANGED (first) — swapping to active')

        // Clear staging timeout
        if (stagingTimerRef.current) {
          clearTimeout(stagingTimerRef.current)
          stagingTimerRef.current = null
        }

        // Carry viewer state and playback position onto the incoming element
        // BEFORE it becomes visible, so neither the volume nor the position
        // visibly jumps at the swap.
        const outgoingEl = slot0IsActiveRef.current ? video0Ref.current : video1Ref.current
        const incomingEl = slot0IsActiveRef.current ? video1Ref.current : video0Ref.current

        if (outgoingEl && incomingEl) {
          incomingEl.volume = outgoingEl.volume
          incomingEl.muted = outgoingEl.muted

          // Only meaningful when there is an outgoing stream to align against —
          // the first play of a game has nothing to be continuous with.
          if (currentHlsRef.current && currentFragsRef.current.length > 0) {
            const target = computeContinuityTarget({
              outgoingFragments: currentFragsRef.current,
              outgoingPosition: outgoingEl.currentTime,
              incomingFragments: stagingFragsRef.current,
              incomingDefaultPosition: incomingEl.currentTime,
            })
            if (target.method === 'pdt') {
              console.log(
                `[usePlayback] continuity: seeking to ${target.position.toFixed(2)}s`,
                target.clamped ? '(clamped — replacement lacks that instant)' : '(exact)'
              )
              incomingEl.currentTime = target.position
            } else {
              console.log('[usePlayback] continuity: no PDT on both sides, joining at live edge')
            }
          }
        }

        // Destroy old active hls.js instance
        if (currentHlsRef.current) {
          currentHlsRef.current.destroy()
        }

        // Toggle active slot — React state drives visibility, no imperative DOM changes
        swapVideos()
        setActiveCandidateId(result.candidateId)

        // Staging hls.js becomes current
        currentHlsRef.current = nextHls
        stagingHlsRef.current = null
        currentFragsRef.current = stagingFragsRef.current
        stagingFragsRef.current = []

        // A frame is on screen. From here a 403 on a segment means an expired
        // token rather than an authorization failure.
        hasPlayedSuccessfullyRef.current = true

        setPlayerState('playing')
      })

      // Keeps this instance's fragment list current so continuity has both
      // sides of the mapping available at swap time.
      nextHls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        stagingFragsRef.current = (data.details?.fragments ?? []).map((f) => ({
          start: f.start,
          duration: f.duration,
          programDateTime: f.programDateTime ?? null,
        }))
      })

      // Stall detection. BUFFER_STALL_ERROR arrives repeatedly while starved, so
      // the machine — not this handler — decides when that becomes a failover.
      nextHls.on(Hls.Events.BUFFER_APPENDED, () => {
        if (currentGameIdRef.current !== gameId) return
        stallMachineRef.current?.onProgress()
      })

      // Fatal errors only — stalls are handled by the stall machine
      nextHls.on(Hls.Events.ERROR, (_event, data) => {
        // hls.js error shapes are narrower than Record<string, unknown>, so each
        // field is widened through unknown purely for diagnostic logging.
        const asRec = (v: unknown): Record<string, unknown> | undefined =>
          v as unknown as Record<string, unknown> | undefined
        console.log('[usePlayback] HLS ERROR:', data.type, data.details, 'fatal:', data.fatal,
          'response:', asRec(data)?.response,
          'status:', asRec(data.context)?.responseStatus ?? asRec(data.response)?.code,
          'url:', asRec(data.context)?.url ?? data.url,
          'networkDetails:', (data.networkDetails as { status?: number } | undefined)?.status
        )
        // Guard against events from destroyed/stale instances
        if (nextHls !== stagingHlsRef.current && nextHls !== currentHlsRef.current) return

        // A buffer stall is not a fatal error and must not be treated as one.
        // It is the single most common way a stream dies without erroring.
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          stallMachineRef.current?.onStall()
          return
        }

        const classified = classifyHlsError(data as unknown as HlsErrorLike, {
          hasPlayedSuccessfully: hasPlayedSuccessfullyRef.current,
        })

        if (classified.action === 'ignore') return

        if (stagingTimerRef.current) {
          clearTimeout(stagingTimerRef.current)
          stagingTimerRef.current = null
        }

        console.log(
          `[usePlayback] classified ${data.details} as ${classified.action}`,
          `reason=${classified.reason} status=${classified.httpStatus}`
        )

        // An expired token is a stale URL on a live source. Re-acquire it rather
        // than abandoning a source that still works. Bounded, so a source that
        // expires instantly cannot loop forever.
        if (classified.action === 'reextract' && retryCountRef.current < 2) {
          retryCountRef.current++
          console.log(`[usePlayback] re-extract ${retryCountRef.current}/2 after ${classified.reason}`)
          if (stagingHlsRef.current) {
            stagingHlsRef.current.destroy()
            stagingHlsRef.current = null
          }
          // Re-acquire onto the staging element and swap on its first frame.
          //
          // This must NOT call playGame(): playGame begins with destroyAll(),
          // which tears down the picture before a replacement exists. That is
          // correct for a user picking a different game and wrong here, where
          // the viewer is mid-stream and only the URL went stale.
          setTimeout(() => {
            if (currentGameIdRef.current !== gameId) return
            window.onair
              .playGame(gameId)
              .then((fresh) => {
                if (currentGameIdRef.current !== gameId) return
                if (fresh.ok) {
                  attachStreamRef.current?.(gameId, fresh)
                } else {
                  requestFailover(gameId, classified.reason)
                }
              })
              .catch(() => requestFailover(gameId, classified.reason))
          }, 1000)
          return
        }

        // Hand off to the escalation ladder. The current stream is left alone —
        // requestFailover only swaps once main returns something that plays.
        requestFailover(gameId, classified.reason, {
          errorType: data.type,
          errorDetails: data.details,
          httpStatus: classified.httpStatus,
          action: classified.action,
        })
      })
    }
  }, [swapVideos, requestFailover])

  // requestFailover is defined before attachStream (the stall machine needs it
  // at construction), so the two are tied together through a ref rather than
  // reordering the hook around a circular dependency.
  useEffect(() => {
    attachStreamRef.current = attachStream
  }, [attachStream])

  const selectCandidate = useCallback(async (candidateId: string): Promise<boolean> => {
    const gameId = currentGameIdRef.current
    if (gameId === null) return false
    const result = await window.onair.selectStream(candidateId).catch(() => null)
    if (!result || !result.ok || currentGameIdRef.current !== gameId) return false
    // Same attach path as failover: the current picture stays up until the
    // chosen stream has a frame ready.
    await attachStreamRef.current?.(gameId, result)
    return true
  }, [])

  // Distance behind the live edge. hls.js estimates it from the playlist, so
  // it is only meaningful for live streams and only while one is attached.
  useEffect(() => {
    if (playerState !== 'playing') return
    const timer = setInterval(() => {
      const latency = currentHlsRef.current?.latency
      setLiveLatency(typeof latency === 'number' && Number.isFinite(latency) && latency > 0 ? latency : null)
    }, 1000)
    return () => clearInterval(timer)
  }, [playerState])

  const stopPlayback = useCallback(() => {
    destroyAll()
    currentGameIdRef.current = null
    setPlayerState('idle')
    setErrorReason(null)
    window.onair.stopPlayback().catch(() => {})
  }, [destroyAll])

  // Cleanup on unmount
  useEffect(() => {
    const machine = stallMachineRef.current
    return () => {
      destroyAll()
      machine?.dispose()
    }
  }, [destroyAll])

  return {
    video0Ref,
    video1Ref,
    slot0IsActive,
    playerState,
    errorReason,
    activeCandidateId,
    liveLatency,
    playGame,
    selectCandidate,
    stopPlayback,
  }
}
