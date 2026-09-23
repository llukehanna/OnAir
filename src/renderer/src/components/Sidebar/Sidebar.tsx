import React, { useState } from 'react'
import {
  Home,
  Trophy,
  Shield,
  GraduationCap,
  Flag,
  Activity,
  ChevronLeft,
  ChevronRight,
  type LucideProps,
} from 'lucide-react'
import { useGames } from '../../context/GamesContext'
import styles from './Sidebar.module.css'

type Screen = 'home' | 'player' | 'diagnostics'

interface SidebarProps {
  screen: Screen
  selectedLeague: LeagueId | null
  onScreenChange: (screen: Screen) => void
  onLeagueChange: (league: LeagueId | null) => void
}

interface LeagueConfig {
  id: LeagueId
  label: string
  // lucide-react icons are ForwardRefExoticComponents, which ComponentType
  // does not accept — type against the library's own props instead.
  icon: React.ComponentType<LucideProps>
}

const LEAGUES: LeagueConfig[] = [
  { id: 'nba', label: 'NBA', icon: Trophy },
  { id: 'nfl', label: 'NFL', icon: Shield },
  { id: 'cbb', label: 'CBB', icon: GraduationCap },
  { id: 'cfb', label: 'CFB', icon: Flag },
]

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function Sidebar({ screen, selectedLeague, onScreenChange, onLeagueChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('onair.sidebar') === 'collapsed'
  )

  const { games } = useGames()

  // Determine which leagues are off-season (no game with startTime within past 7 days)
  const now = Date.now()
  const offSeasonLeagues = new Set<LeagueId>(
    LEAGUES
      .filter(({ id }) => !games.some((g) => g.league === id && g.startTime >= now - SEVEN_DAYS_MS))
      .map(({ id }) => id)
  )

  // Determine which leagues have LIVE games
  const liveLeagues = new Set<LeagueId>(
    games.filter((g) => g.status === 'LIVE').map((g) => g.league)
  )

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('onair.sidebar', next ? 'collapsed' : 'expanded')
  }

  const handleLeagueClick = (league: LeagueId) => {
    if (screen !== 'home') {
      onScreenChange('home')
    }
    onLeagueChange(league)
  }

  const handleAllGamesClick = () => {
    onScreenChange('home')
    onLeagueChange(null)
  }

  const handleDiagnosticsClick = () => {
    onScreenChange('diagnostics')
  }

  const isAllGamesActive = selectedLeague === null && screen === 'home'
  const isDiagnosticsActive = screen === 'diagnostics'

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : styles.sidebarExpanded}`}
    >
      {/* Header: wordmark + collapse toggle */}
      <div className={styles.header}>
        <span className={`${styles.wordmark} ${collapsed ? styles.wordmarkCollapsed : ''}`}>
          {collapsed ? '·' : 'OnAir'}
        </span>
        <button
          className={styles.toggleBtn}
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight size={18} />
            : <ChevronLeft size={18} />
          }
        </button>
      </div>

      {/* Nav items */}
      <div className={styles.nav}>
        {/* All Games */}
        <button
          className={`${styles.navItem} ${isAllGamesActive ? styles.navItemActive : ''}`}
          data-league="all"
          onClick={handleAllGamesClick}
          aria-current={isAllGamesActive ? 'page' : undefined}
        >
          <div className={styles.iconWrapper}>
            <Home size={24} className={styles.icon} />
          </div>
          <span className={`${styles.label} ${isAllGamesActive ? styles.labelActive : ''} ${collapsed ? styles.labelHidden : ''}`}>
            All Games
          </span>
        </button>

        {/* League items — skip off-season leagues */}
        {LEAGUES.filter(({ id }) => !offSeasonLeagues.has(id)).map(({ id, label, icon: Icon }) => {
          const isActive = selectedLeague === id && screen === 'home'
          const isLive = liveLeagues.has(id)

          return (
            <button
              key={id}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              data-league={id}
              onClick={() => handleLeagueClick(id)}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className={styles.iconWrapper}>
                <Icon size={24} className={styles.icon} />
                {isLive && <span className={styles.liveDot} aria-hidden="true" />}
              </div>
              <span className={`${styles.label} ${isActive ? styles.labelActive : ''} ${collapsed ? styles.labelHidden : ''}`}>
                {label}
              </span>
            </button>
          )
        })}

        {/* Divider */}
        <div className={styles.divider} aria-hidden="true" />

        {/* Diagnostics */}
        <button
          className={`${styles.navItem} ${isDiagnosticsActive ? styles.navItemActive : ''}`}
          data-league="diagnostics"
          onClick={handleDiagnosticsClick}
          aria-current={isDiagnosticsActive ? 'page' : undefined}
        >
          <div className={styles.iconWrapper}>
            <Activity size={24} className={styles.icon} />
          </div>
          <span className={`${styles.label} ${isDiagnosticsActive ? styles.labelActive : ''} ${collapsed ? styles.labelHidden : ''}`}
            style={{ color: isDiagnosticsActive ? undefined : 'var(--text-secondary)' }}
          >
            Diagnostics
          </span>
        </button>
      </div>
    </nav>
  )
}
