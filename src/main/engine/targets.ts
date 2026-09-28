import type { Game, Channel, WatchTarget } from '../types'
import { CHANNEL_ID_PREFIX } from '../types'
import { getGameById } from '../db/queries/games'
import { getChannelById } from '../db/queries/channels'

/**
 * True for a channel id (`ch:...`). Everything else is assumed to be a game
 * id — the two id spaces never overlap by construction.
 */
export function isChannelId(id: string): boolean {
  return id.startsWith(CHANNEL_ID_PREFIX)
}

/**
 * Looks up whatever `id` refers to and wraps it as a WatchTarget, so
 * candidates.ts and PlaybackManager can treat a game and a channel the same
 * way. Returns null when the id doesn't resolve to anything — an unknown
 * game, or a channel that was pruned.
 */
export function resolveTarget(
  id: string,
  deps?: { getGame?: (id: string) => Game | null; getChannel?: (id: string) => Channel | null }
): WatchTarget | null {
  const getGame = deps?.getGame ?? getGameById
  const getChannel = deps?.getChannel ?? getChannelById

  if (isChannelId(id)) {
    const channel = getChannel(id)
    if (!channel) return null
    return { kind: 'channel', id, scope: 'channel', channel }
  }

  const game = getGame(id)
  if (!game) return null
  return { kind: 'game', id, scope: game.league, game }
}
