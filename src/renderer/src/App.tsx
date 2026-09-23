import React, { useState } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
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

  const handleGameClick = (gameId: string) => {
    setSelectedGameId(gameId)
    setScreen('player')
    playGame(gameId)
  }

  const handleBack = () => {
    stopPlayback()
    setSelectedGameId(null)
    setScreen('home')
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        screen={screen}
        selectedLeague={selectedLeague}
        onScreenChange={setScreen}
        onLeagueChange={setSelectedLeague}
      />
      <main className={styles.main}>
        {screen === 'home' && (
          <HomeScreen selectedLeague={selectedLeague} onGameClick={handleGameClick} />
        )}
        {screen === 'player' && (
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
            onBack={handleBack}
            onRetry={() => {
              console.log('[App] retry clicked, gameId:', selectedGameId)
              if (selectedGameId) playGame(selectedGameId)
            }}
          />
        )}
        {screen === 'diagnostics' && <DiagnosticsScreen />}
      </main>
    </div>
  )
}
