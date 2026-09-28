import React, { useRef, useState } from 'react'
import { TopBar } from './components/TopBar/TopBar'
import { HomeScreen } from './screens/HomeScreen/HomeScreen'
import { PlayerScreen } from './screens/PlayerScreen/PlayerScreen'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen/DiagnosticsScreen'
import { usePlayback } from './hooks/usePlayback'
import styles from './App.module.css'

export type Screen = 'home' | 'player' | 'diagnostics'

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  const [selectedLeague, setSelectedLeague] = useState<LeagueId | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const {
    playGame,
    selectCandidate,
    stopPlayback,
    video0Ref,
    video1Ref,
    slot0IsActive,
    playerState,
    errorReason,
    activeCandidateId,
    liveLatency,
  } = usePlayback()

  const go = (next: Screen) => {
    setScreen(next)
    mainRef.current?.scrollTo({ top: 0 })
    setScrolled(false)
  }

  const handleGameClick = (gameId: string) => {
    setSelectedGameId(gameId)
    setScreen('player')
    playGame(gameId)
  }

  const leavePlayer = (next: Screen) => {
    stopPlayback()
    setSelectedGameId(null)
    go(next)
  }

  if (screen === 'player') {
    return (
      <PlayerScreen
        gameId={selectedGameId}
        video0Ref={video0Ref}
        video1Ref={video1Ref}
        slot0IsActive={slot0IsActive}
        playerState={playerState}
        errorReason={errorReason}
        activeCandidateId={activeCandidateId}
        liveLatency={liveLatency}
        onSelectCandidate={selectCandidate}
        onBack={() => leavePlayer('home')}
        onOpenDiagnostics={() => leavePlayer('diagnostics')}
        onRetry={() => {
          if (selectedGameId) playGame(selectedGameId)
        }}
      />
    )
  }

  return (
    <div className={styles.shell}>
      <TopBar
        onDiagnostics={screen === 'diagnostics'}
        league={selectedLeague}
        onLeague={(league) => {
          setSelectedLeague(league)
          go('home')
        }}
        onOpenDiagnostics={() => go('diagnostics')}
        onHome={() => {
          setSelectedLeague(null)
          go('home')
        }}
        scrolled={scrolled}
      />
      <main
        ref={mainRef}
        className={styles.main}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      >
        {screen === 'home' && <HomeScreen selectedLeague={selectedLeague} onGameClick={handleGameClick} />}
        {screen === 'diagnostics' && <DiagnosticsScreen />}
      </main>
    </div>
  )
}
