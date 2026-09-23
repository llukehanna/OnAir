import React, { useState, useRef, useEffect } from 'react'
import { useGames } from '../../context/GamesContext'
import { LoadingState, AllSourcesFailed } from '../../components/LoadingState/LoadingState'
import { PlayerControls } from '../../components/PlayerControls/PlayerControls'
import { SourceSwitcher } from '../../components/SourceSwitcher/SourceSwitcher'
import { FailoverToast } from '../../components/FailoverToast/FailoverToast'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
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
}

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
}: PlayerScreenProps): React.JSX.Element {
  const { games } = useGames()
  const game = games.find((g) => g.gameId === gameId)

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

  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mouseMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keyboard shortcuts — active when playing
  useKeyboardShortcuts({
    videoRef: slot0IsActive ? video0Ref : video1Ref,
    enabled: playerState === 'playing',
  })

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
  }

  // Keyboard shortcuts: Escape exits fullscreen (or goes back), F toggles fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false)
        else onBack()
      }
      if (e.key === 'f' || e.key === 'F') {
        if (playerState === 'playing') toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack, isFullscreen, playerState])

  const handleVideoAreaMouseMove = () => {
    setControlsVisible(true)
    if (mouseMoveTimerRef.current) clearTimeout(mouseMoveTimerRef.current)
    mouseMoveTimerRef.current = setTimeout(() => setControlsVisible(false), 3000)
  }

  return (
    <div className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''}`}>
      {/* Video Area — 65% normally, 100% in fullscreen */}
      <div
        className={`${styles.videoArea} ${isFullscreen ? styles.videoAreaFullscreen : ''}`}
        onMouseMove={handleVideoAreaMouseMove}
        onDoubleClick={() => { if (playerState === 'playing') toggleFullscreen() }}
      >
        {/* Slot 0 — visible when playing and slot 0 is the active slot */}
        <video
          ref={video0Ref}
          className={styles.video}
          style={{ display: playerState === 'playing' && slot0IsActive ? 'block' : 'none' }}
          playsInline
        />

        {/* Slot 1 — visible when playing and slot 1 is the active slot */}
        <video
          ref={video1Ref}
          className={styles.video}
          style={{ display: playerState === 'playing' && !slot0IsActive ? 'block' : 'none' }}
          playsInline
        />

        {/* State overlays */}
        {playerState === 'loading' && <LoadingState game={game} />}

        {playerState === 'error' && (
          <AllSourcesFailed
            game={game}
            reason={errorReason}
            onRetry={onRetry}
            onPickSource={() => setSourcePickerOpen(true)}
            onBack={onBack}
          />
        )}

        {playerState === 'idle' && (
          <div className={styles.idleOverlay}>
            <span className={styles.idleText}>Select a game to start watching</span>
          </div>
        )}

        {/* PlayerControls overlay */}
        {playerState === 'playing' && (
          <PlayerControls
            videoRef={slot0IsActive ? video0Ref : video1Ref}
            gameTitle={game ? `${game.teamAway} vs ${game.teamHome}` : ''}
            gameClock={game?.status === 'LIVE' ? 'LIVE' : ''}
            visible={controlsVisible}
          />
        )}
      </div>

      {/* Info Panel — 35%, hidden in fullscreen */}
      <div className={styles.infoPanel} style={{ display: isFullscreen ? 'none' : undefined }}>
        {/* Game title section */}
        <div className={styles.glassCard}>
          {game ? (
            <>
              <div className={`${styles.leagueBadge} ${styles[`league_${game.league}`]}`}>
                {game.league.toUpperCase()}
              </div>
              <h1 className={styles.gameTitle}>
                {game.teamAway} vs {game.teamHome}
              </h1>
              <div className={styles.statusRow}>
                <span
                  className={`${styles.statusBadge} ${
                    game.status === 'LIVE'
                      ? styles.statusLive
                      : game.status === 'STARTING_SOON'
                        ? styles.statusSoon
                        : styles.statusEnded
                  }`}
                >
                  {game.status === 'LIVE'
                    ? 'LIVE'
                    : game.status === 'STARTING_SOON'
                      ? 'SOON'
                      : game.status === 'RECENTLY_ENDED'
                        ? 'FINAL'
                        : 'SCHEDULED'}
                </span>
              </div>
            </>
          ) : (
            <p className={styles.notFoundText}>Game not found</p>
          )}

          {/* Back button */}
          <button className={styles.backButton} onClick={onBack} aria-label="Back to home">
            &larr; Back
          </button>
        </div>

        {/* Stream info section */}
        <div className={styles.glassCard}>
          <p className={styles.sectionLabel}>Stream Info</p>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Source</span>
            <span className={styles.infoValue}>{streamInfo?.source ?? '—'}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Quality</span>
            <span className={styles.infoValue}>{streamInfo?.quality ?? '—'}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Behind live</span>
            <span className={styles.infoValue}>
              {liveLatency !== null ? `${liveLatency.toFixed(1)}s` : '—'}
            </span>
          </div>
        </div>

        {/* SourceSwitcher — inline panel */}
        {gameId && (
          <div className={styles.glassCard}>
            <SourceSwitcher
              gameId={gameId}
              open={sourcePickerOpen}
              activeCandidateId={activeCandidateId}
              onOpen={() => setSourcePickerOpen(true)}
              onClose={() => setSourcePickerOpen(false)}
              onSelect={onSelectCandidate}
            />
          </div>
        )}

        {/* Open source switcher button — visible when no gameId-based card is shown */}
        {!gameId && (
          <div className={styles.glassCard}>
            <button
              className={styles.switchSourceButton}
              onClick={() => setSourcePickerOpen(!sourcePickerOpen)}
              aria-label="Switch stream source"
            >
              ⇄ Switch Source
            </button>
          </div>
        )}
      </div>

      {/* FailoverToast — fixed position, manages its own placement */}
      <FailoverToast />
    </div>
  )
}
