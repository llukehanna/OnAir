import { BrowserWindow } from 'electron'
import { fetchLeague } from './fetcher'
import { normalizeEvents } from './normalizer'
import { upsertGame, getGames } from '../db/queries/games'
import { appendEvent } from '../db/queries/events'
import { getDb } from '../db/connection'
import Database from 'better-sqlite3'
import type { Game, LeagueId } from '../types'

const LEAGUES: LeagueId[] = ['nba', 'nfl', 'mlb', 'cbb', 'cfb']

let timeoutHandle: ReturnType<typeof setTimeout> | null = null
let lastSuccessfulPollAt = 0
let gamesUpdatedCallback: ((update: { games: Game[], isStale: boolean }) => void) | null = null

export function computeInterval(games: Game[]): number {
  const now = Date.now()
  const hasLive = games.some(g => g.status === 'LIVE')
  if (hasLive) return 60_000

  const hasImminent = games.some(
    g =>
      g.status === 'STARTING_SOON' ||
      (g.status === 'SCHEDULED' && g.startTime - now < 60 * 60_000)
  )
  if (hasImminent) return 120_000

  return 600_000
}

export function isLeagueOffSeason(league: LeagueId, db?: Database.Database): boolean {
  const d = db ?? getDb()
  const row = d.prepare(`
    SELECT COUNT(*) as count FROM games
    WHERE league = ? AND start_time > (unixepoch() * 1000 - 604800000)
  `).get(league) as { count: number }
  return row.count === 0
}

async function poll(win: BrowserWindow): Promise<void> {
  try {
    const results = await Promise.allSettled(
      LEAGUES.map(async (league) => {
        const events = await fetchLeague(league)
        const games = normalizeEvents(events, league)

        // Store each game's OWN event, not the whole league payload.
        //
        // This previously passed JSON.stringify(events) inside the loop, which
        // wrote the full ~50-game ESPN response into every single row — the
        // same payload duplicated once per game, re-serialized on every poll.
        // It grew the games table to 140MB for 255 rows and burned CPU every
        // 60 seconds. raw_data is diagnostic only; nothing reads it back.
        const eventById = new Map(events.map((e) => [String(e.id), e]))
        for (const game of games) {
          const espnId = game.gameId.split('_')[1]
          const own = eventById.get(espnId)
          upsertGame(game, own ? JSON.stringify(own) : null)
        }
        return games
      })
    )

    const anySuccess = results.some(r => r.status === 'fulfilled')

    if (anySuccess) {
      lastSuccessfulPollAt = Date.now()
    } else {
      appendEvent('api_failure', { details: { reason: 'all_leagues_failed' } })
    }

    const allGames = getGames()
    const isStale = lastSuccessfulPollAt === 0 || Date.now() - lastSuccessfulPollAt > 5 * 60_000

    if (!win.isDestroyed()) {
      win.webContents.send('games-updated', { games: allGames, isStale })
    }

    if (gamesUpdatedCallback) {
      gamesUpdatedCallback({ games: allGames, isStale })
    }

    const nextInterval = computeInterval(allGames)
    timeoutHandle = setTimeout(() => poll(win), nextInterval)
  } catch (err) {
    console.error('[discovery] poll() threw unexpectedly:', err)
    // Reschedule even on unexpected error — scheduler must not die silently
    timeoutHandle = setTimeout(() => poll(win), 600_000)
  }
}

export function startDiscovery(
  win: BrowserWindow,
  onGamesUpdated?: (update: { games: Game[], isStale: boolean }) => void
): void {
  gamesUpdatedCallback = onGamesUpdated ?? null
  poll(win) // immediate first poll — no initial delay
}

export function stopDiscovery(): void {
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
  gamesUpdatedCallback = null
}
