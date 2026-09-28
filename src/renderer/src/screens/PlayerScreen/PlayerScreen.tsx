import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useGames } from '../../context/GamesContext'
import { LoadingState, AllSourcesFailed } from '../../components/LoadingState/LoadingState'
import { PlayerControls } from '../../components/PlayerControls/PlayerControls'
import { PlayerDrawer } from '../../components/PlayerDrawer/PlayerDrawer'
import { SourceList } from '../../components/SourceList/SourceList'
import { FailoverToast } from '../../components/FailoverToast/FailoverToast'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { usePlayerMedia } from '../../hooks/usePlayerMedia'
import { leagueLabel, matchupLabel, statusText } from '../../lib/teams'
import { formatKickoff } from '../../lib/time'
import styles from './PlayerScreen.module.css'

interface PlayerScreenProps {
  gameId: string | null
  video0Ref: React.MutableRefObject<HTMLVideoElement | null>
  video1Ref: React.MutableRefObject<HTMLVideoElement | null>
  slot0IsActive: boolean
  playerState: 'idle' | 'loading' | 'playing' | 'error'
  errorReason: string | null
  activeCandidateId: string | null
  liveLatency: number | null
  onSelectCandidate: (candidateId: string) => Promise<boolean>
  onBack: () => void
  onRetry: () => void
  onOpenDiagnostics: () => void
}

const IDLE_HIDE_MS = 3000

export function PlayerScreen({
  gameId,
  video0Ref,
  video1Ref,
  slot0IsActive,
  playerState,
  errorReason,
  activeCandidateId,
  liveLatency,
  onSelectCandidate,
  onBack,
  onRetry,
  onOpenDiagnostics,
}: PlayerScreenProps): React.JSX.Element {
  const { games } = useGames()
  const game = games.find((g) => g.gameId === gameId)
  const playing = playerState === 'playing'
  const activeRef = slot0IsActive ? video0Ref : video1Ref

  const media = usePlayerMedia({ video0Ref, video1Ref, activeRef, liveLatency, streamKey: activeCandidateId })

  // --- Stream facts for the drawer -------------------------------------------

  // Resolve the on-screen candidate to something a person can read. Candidates
  // and source names both live in main, so re-fetch whenever the stream changes.
  const [streamInfo, setStreamInfo] = useState<{ source: string; quality: string | null } | null>(null)
  useEffect(() => {
    if (!gameId || !activeCandidateId) {
      setStreamInfo(null)
      return
    }
    let cancelled = false
    Promise.all([
      window.onair.getCandidatesForGame(gameId).catch(() => [] as StreamCandidate[]),
      window.onair.getSources().catch(() => [] as Source[]),
    ]).then(([candidates, sources]) => {
      if (cancelled) return
      const active = candidates.find((c) => c.candidateId === activeCandidateId)
      if (!active) {
        setStreamInfo(null)
        return
      }
      const name = sources.find((s) => s.sourceId === active.sourceId)?.name ?? active.sourceId
      setStreamInfo({ source: name, quality: active.quality })
    })
    return () => {
      cancelled = true
    }
  }, [gameId, activeCandidateId])

  // Time on air counts from the first frame and survives failovers.
  const onAirSince = useRef<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    onAirSince.current = null
  }, [gameId])
  if (playing && onAirSince.current === null) onAirSince.current = Date.now()
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [playing])
  const onAirSec = onAirSince.current ? (now - onAirSince.current) / 1000 : 0

  const [failovers, setFailovers] = useState(0)
  useEffect(() => {
    setFailovers(0)
    return window.onair.onPlaybackEvent((event) => {
      if (event.type === 'source_switch' && event.gameId === gameId && event.details?.reason !== 'user_selected') {
        setFailovers((n) => n + 1)
      }
    })
  }, [gameId])

  // --- Drawer and fullscreen ------------------------------------------------

  const [drawerOpen, setDrawerOpen] = useState(() => localStorage.getItem('onair.drawer') !== 'closed')
  const setDrawer = useCallback((open: boolean) => {
    setDrawerOpen(open)
    localStorage.setItem('onair.drawer', open ? 'open' : 'closed')
  }, [])

  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)
  const exitedAt = useRef(0)
  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement
      if (!fs) exitedAt.current = Date.now()
      setIsFullscreen(fs)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Leaving the player shouldn't leave the window stuck in fullscreen.
  useEffect(() => () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  // --- Chrome visibility ----------------------------------------------------

  const [active, setActive] = useState(true)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wake = useCallback(() => {
    setActive(true)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS)
  }, [])
  useEffect(() => {
    wake()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [wake])
  // Chrome stays up whenever there is no picture to look at, or it's paused.
  const chromeVisible = active || !playing || media.paused

  // --- Keyboard -------------------------------------------------------------

  useKeyboardShortcuts({ videoRef: activeRef, enabled: playing })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      switch (e.key) {
        case 'Escape':
          if (document.fullscreenElement) {
            e.preventDefault()
            document.exitFullscreen().catch(() => {})
          } else if (Date.now() - exitedAt.current > 400) {
            // The same Escape that just left fullscreen must not also leave the player.
            onBack()
          }
          break
        case 'f':
        case 'F':
          if (playing) {
            e.preventDefault()
            toggleFullscreen()
          }
          break
        case 'r':
        case 'R':
          e.preventDefault()
          setDrawer(!drawerOpen)
          break
        case 'm':
        case 'M':
          e.preventDefault()
          media.toggleMute()
          break
        default:
          return
      }
      wake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, playing, toggleFullscreen, drawerOpen, setDrawer, media, wake])

  // --- Render ---------------------------------------------------------------

  const title = game ? matchupLabel(game) : 'Game unavailable'
  const status = game ? (game.status === 'LIVE' || game.status === 'RECENTLY_ENDED' ? statusText(game) : formatKickoff(game.startTime)) : ''
  const meta = game ? [status, game.network, leagueLabel(game.league)].filter(Boolean).join(' · ') : ''

  return (
    <div className={`${styles.screen} ${isFullscreen ? styles.fullscreen : ''}`}>
      <div
        className={`${styles.stage} ${chromeVisible ? '' : styles.idle}`}
        onMouseMove={wake}
        onMouseDown={wake}
      >
        {/* Both slots stay mounted; usePlayback swaps which one is visible. */}
        <video
          ref={video0Ref}
          className={styles.video}
          style={{ display: playing && slot0IsActive ? 'block' : 'none' }}
          playsInline
        />
        <video
          ref={video1Ref}
          className={styles.video}
          style={{ display: playing && !slot0IsActive ? 'block' : 'none' }}
          playsInline
        />

        {/* Catches double-clicks over the picture without covering the controls. */}
        {playing && <div className={styles.hitArea} onDoubleClick={toggleFullscreen} />}

        {playerState === 'loading' && <LoadingState game={game} />}

        {playerState === 'error' && (
          <AllSourcesFailed
            game={game}
            reason={errorReason}
            onRetry={onRetry}
            onPickSource={() => setDrawer(true)}
            onBack={onBack}
            onOpenDiagnostics={onOpenDiagnostics}
          />
        )}

        {playerState === 'idle' && (
          <div className={styles.idleState}>
            <p>Pick a game to start watching.</p>
          </div>
        )}

        <div className={`${styles.chromeTop} ${chromeVisible ? styles.shown : ''} ${playing ? styles.scrim : ''}`}>
          <button className={styles.back} onClick={onBack} aria-label="Back to games" title="Back (Esc)">
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{title}</h1>
            {meta && (
              <p className={styles.meta}>
                {game?.status === 'LIVE' && <span className={styles.liveDot} aria-hidden="true" />}
                {meta}
              </p>
            )}
          </div>
        </div>

        {playing && (
          <div className={`${styles.chromeBottom} ${chromeVisible ? styles.shown : ''}`}>
            <PlayerControls
              media={media}
              liveLatency={liveLatency}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              drawerOpen={drawerOpen}
              onToggleDrawer={() => setDrawer(!drawerOpen)}
            />
          </div>
        )}

        <FailoverToast />
      </div>

      <PlayerDrawer
        game={game}
        open={drawerOpen}
        overlay={isFullscreen}
        stats={{
          source: playing ? streamInfo?.source ?? null : null,
          quality: playing ? streamInfo?.quality ?? null : null,
          // Nothing is on air while loading or failed; don't show a stale stream.
          latency: playing ? liveLatency : null,
          onAirSec: playing ? onAirSec : 0,
          failovers,
        }}
      >
        {gameId ? (
          <SourceList gameId={gameId} activeCandidateId={playing ? activeCandidateId : null} onSelect={onSelectCandidate} />
        ) : (
          <p className={styles.noGame}>No game selected.</p>
        )}
      </PlayerDrawer>
    </div>
  )
}
