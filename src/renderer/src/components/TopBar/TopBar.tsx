import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, Search, X } from 'lucide-react'
import { useGames } from '../../context/GamesContext'
import { useGuide } from '../../context/GuideContext'
import { LEAGUE_ORDER, leagueShort } from '../../lib/teams'
import { CATEGORY_ORDER, categoryLabel, liveChannelIds, type GuideCategory } from '../../lib/guide'
import styles from './TopBar.module.css'

export type BarScreen = 'home' | 'guide' | 'diagnostics'

interface TopBarProps {
  screen: BarScreen
  onNavigate: (screen: 'home' | 'guide') => void
  league: LeagueId | null
  onLeague: (league: LeagueId | null) => void
  category: GuideCategory
  onCategory: (category: GuideCategory) => void
  query: string
  onQuery: (query: string) => void
  onOpenDiagnostics: () => void
  /** Content is scrolled beneath the bar; show the frosted backing. */
  scrolled: boolean
}

interface Segment<T> {
  id: T
  label: string
  live: boolean
}

export function TopBar({
  screen,
  onNavigate,
  league,
  onLeague,
  category,
  onCategory,
  query,
  onQuery,
  onOpenDiagnostics,
  scrolled,
}: TopBarProps): React.JSX.Element {
  const { games } = useGames()
  const { channels, programs } = useGuide()
  const anyLive = games.some((g) => g.status === 'LIVE')

  // Home: only leagues with something on the schedule get a segment.
  const leagueSegments = useMemo<Array<Segment<LeagueId | null>>>(() => {
    const present = new Set(games.map((g) => g.league))
    const live = new Set(games.filter((g) => g.status === 'LIVE').map((g) => g.league))
    return [
      { id: null, label: 'All', live: false },
      ...LEAGUE_ORDER.filter((l) => present.has(l)).map((l) => ({ id: l, label: leagueShort(l), live: live.has(l) })),
    ]
  }, [games])

  // Guide: the same rule for categories — plus the selected one, so a filter
  // never vanishes out from under the viewer.
  const categorySegments = useMemo<Array<Segment<GuideCategory>>>(() => {
    const liveGames = new Set(games.filter((g) => g.status === 'LIVE').map((g) => g.gameId))
    const liveChannels = liveChannelIds(programs, liveGames)
    const present = new Set(channels.map((c) => c.category))
    const live = new Set(channels.filter((c) => liveChannels.has(c.channelId)).map((c) => c.category))
    return [
      { id: 'all' as const, label: 'All', live: false },
      ...CATEGORY_ORDER.filter((c) => present.has(c) || c === category).map((c) => ({
        id: c,
        label: categoryLabel(c),
        live: live.has(c),
      })),
    ]
  }, [games, channels, programs, category])

  return (
    <header className={`${styles.bar} ${scrolled ? styles.scrolled : ''}`}>
      <button className={styles.brand} onClick={() => onNavigate('home')} aria-label="OnAir home">
        <span className={`${styles.tally} ${anyLive ? styles.tallyLive : ''}`} aria-hidden="true" />
        <span className={styles.brandWord}>OnAir</span>
      </button>

      <nav className={styles.nav} aria-label="Primary">
        <NavLink label="Home" active={screen === 'home'} onClick={() => onNavigate('home')} />
        <NavLink label="Guide" active={screen === 'guide'} onClick={() => onNavigate('guide')} />
      </nav>

      {screen === 'home' && (
        <Segmented key="league" label="League" segments={leagueSegments} selected={league} onSelect={onLeague} />
      )}
      {/* Nothing to filter until discovery has found something. */}
      {screen === 'guide' && channels.length > 0 && (
        <Segmented key="category" label="Category" segments={categorySegments} selected={category} onSelect={onCategory} />
      )}

      <div className={styles.spacer} />

      {screen === 'guide' && channels.length > 0 && <SearchField value={query} onChange={onQuery} />}

      <button
        className={`${styles.iconButton} ${screen === 'diagnostics' ? styles.iconButtonOn : ''}`}
        onClick={onOpenDiagnostics}
        aria-label="Diagnostics"
        aria-current={screen === 'diagnostics' ? 'page' : undefined}
        title="Diagnostics"
      >
        <Activity size={17} strokeWidth={1.8} />
      </button>
    </header>
  )
}

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button className={`${styles.navLink} ${active ? styles.navLinkOn : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {label}
    </button>
  )
}

interface SegmentedProps<T> {
  label: string
  segments: Array<Segment<T>>
  selected: T
  onSelect: (id: T) => void
}

function Segmented<T>({ label, segments, selected, onSelect }: SegmentedProps<T>): React.JSX.Element {
  // Slide a single white pill under the selected segment instead of
  // repainting each button, so switching feels physical.
  const segRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const selectedIndex = segments.findIndex((s) => s.id === selected)
  const labels = segments.map((s) => s.label).join('|')

  useLayoutEffect(() => {
    const el = segRef.current?.querySelectorAll<HTMLButtonElement>('button')[selectedIndex]
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
  }, [selectedIndex, labels])

  return (
    <div className={styles.segments} ref={segRef} role="tablist" aria-label={label}>
      {pill && (
        <span className={styles.pill} style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
      )}
      {segments.map((s, i) => (
        <button
          key={s.label}
          role="tab"
          aria-selected={i === selectedIndex}
          className={`${styles.segment} ${i === selectedIndex ? styles.segmentOn : ''}`}
          onClick={() => onSelect(s.id)}
        >
          {s.label}
          {s.live && <span className={styles.liveDot} aria-label="live" />}
        </button>
      ))}
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘F and / jump to search, as they do in every other list worth searching.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName?.toLowerCase() === 'input'
      if ((e.metaKey && e.key.toLowerCase() === 'f') || (!typing && e.key === '/')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <label className={`${styles.search} ${value ? styles.searchFilled : ''}`}>
      <Search size={15} strokeWidth={2} className={styles.searchIcon} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        value={value}
        placeholder="Search channels"
        aria-label="Search channels"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('')
            e.currentTarget.blur()
          }
        }}
      />
      {value && (
        <button className={styles.searchClear} onClick={() => onChange('')} aria-label="Clear search" type="button">
          <X size={12} strokeWidth={2.6} />
        </button>
      )}
    </label>
  )
}
