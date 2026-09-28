import React, { useRef, useState } from 'react'
import { TopBar } from './components/TopBar/TopBar'
import { HomeScreen } from './screens/HomeScreen/HomeScreen'
import { PlayerScreen } from './screens/PlayerScreen/PlayerScreen'
import { GuideScreen } from './screens/GuideScreen/GuideScreen'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen/DiagnosticsScreen'
import { usePlayback } from './hooks/usePlayback'
import type { GuideCategory } from './lib/guide'
import styles from './App.module.css'

export type Screen = 'home' | 'guide' | 'player' | 'diagnostics'

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('home')
  const [selectedLeague, setSelectedLeague] = useState<LeagueId | null>(null)
  const [guideCategory, setGuideCategory] = useState<GuideCategory>('all')
  const [guideQuery, setGuideQuery] = useState('')
  /** A game id, or a channel id (`ch:…`) — both play through playGame. */
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  /** Where Back from the player returns: the guide when a channel was tuned from it. */
  const [returnTo, setReturnTo] = useState<Screen>('home')
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
    setReturnTo(screen === 'guide' ? 'guide' : 'home')
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
        onBack={() => leavePlayer(returnTo)}
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
        screen={screen}
        onNavigate={(next) => {
          if (next === 'home') setSelectedLeague(null)
          go(next)
        }}
        league={selectedLeague}
        onLeague={(league) => {
          setSelectedLeague(league)
          go('home')
        }}
        category={guideCategory}
        onCategory={setGuideCategory}
        query={guideQuery}
        onQuery={setGuideQuery}
        onOpenDiagnostics={() => go('diagnostics')}
        scrolled={scrolled}
      />
      <main
        ref={mainRef}
        className={styles.main}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      >
        {screen === 'home' && <HomeScreen selectedLeague={selectedLeague} onGameClick={handleGameClick} />}
        {screen === 'guide' && (
          <GuideScreen
            category={guideCategory}
            query={guideQuery}
            onTune={handleGameClick}
            onClearFilters={() => {
              setGuideCategory('all')
              setGuideQuery('')
            }}
          />
        )}
        {screen === 'diagnostics' && <DiagnosticsScreen />}
      </main>
    </div>
  )
}
