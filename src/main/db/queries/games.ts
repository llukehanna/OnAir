import Database from 'better-sqlite3'
import { getDb } from '../connection'
import type { Game, LeagueId, GameStatus } from '../../types'

type GameDetail = Pick<Game, 'away' | 'home' | 'statusDetail' | 'network' | 'venue' | 'headline'>

const DETAIL_KEYS = ['away', 'home', 'statusDetail', 'network', 'venue', 'headline'] as const

interface GameRow {
  game_id: string
  league: string
  team_home: string
  team_away: string
  start_time: number
  status: string
  raw_data: string | null
  detail_json: string | null
  cached_at: number
}

function serializeDetail(game: Game): string | null {
  const entries = DETAIL_KEYS.filter((k) => game[k] !== undefined).map((k) => [k, game[k]])
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : null
}

/** Null or invalid JSON means the detail fields are simply absent. */
function parseDetail(json: string | null): GameDetail {
  if (!json) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const source = parsed as Record<string, unknown>
  return Object.fromEntries(
    DETAIL_KEYS.filter((k) => source[k] !== undefined && source[k] !== null).map((k) => [k, source[k]])
  ) as GameDetail
}

function rowToGame(row: GameRow): Game {
  return {
    gameId: row.game_id,
    league: row.league as LeagueId,
    teamHome: row.team_home,
    teamAway: row.team_away,
    startTime: row.start_time,
    status: row.status as GameStatus,
    ...parseDetail(row.detail_json),
  }
}

export function upsertGame(game: Game, rawData?: string | null, db?: Database.Database): void {
  const d = db ?? getDb()
  d.prepare(`
    INSERT OR REPLACE INTO games (game_id, league, team_home, team_away, start_time, status, raw_data, detail_json, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    game.gameId,
    game.league,
    game.teamHome,
    game.teamAway,
    game.startTime,
    game.status,
    rawData ?? null,
    serializeDetail(game),
    Date.now()
  )
}

export function getGames(league?: LeagueId, db?: Database.Database): Game[] {
  const d = db ?? getDb()
  const cutoff = Date.now() - 24 * 60 * 60_000 // only games seen in the last 24 hours
  let rows: GameRow[]
  if (league) {
    rows = d.prepare('SELECT * FROM games WHERE league = ? AND cached_at > ?').all(league, cutoff) as GameRow[]
  } else {
    rows = d.prepare('SELECT * FROM games WHERE cached_at > ?').all(cutoff) as GameRow[]
  }
  return rows.map(rowToGame)
}

export function getGameById(gameId: string, db?: Database.Database): Game | null {
  const d = db ?? getDb()
  const row = d.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId) as GameRow | undefined
  return row ? rowToGame(row) : null
}

export function deleteOldGames(maxAgeMs: number, db?: Database.Database): void {
  const d = db ?? getDb()
  const cutoff = Date.now() - maxAgeMs
  d.prepare(`
    DELETE FROM games WHERE status = 'RECENTLY_ENDED' AND start_time < ?
  `).run(cutoff)
}
