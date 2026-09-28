import { ipcMain } from 'electron'
import { getGames } from '../db/queries/games'
import type { LeagueId, PlaybackEventType, Source } from '../types'
import { PlaybackManager } from '../playback/manager'
import { getSources, updateSource, addSource } from '../db/queries/sources'
import { addSourcesBulk } from '../sources/bulk-add'
import { isFixtureModeEnabled, setFixtureMode, getFixtureMode } from '../dev/fixture-adapter'
import type { FailureMode } from '../dev/hls-fixture'
import { getRecentEvents } from '../db/queries/events'
import { getCacheEntries } from '../engine/cache'
import { getChannels } from '../db/queries/channels'
import { discoverOnce } from '../channels/scheduler'
import { getOrBuildGuide } from '../channels/listings'
import { getAllAdapters } from '../adapters/registry'
import type { PlaywrightPool } from '../adapters/pool'

export function registerHandlers(playbackManager: PlaybackManager, pool?: PlaywrightPool): void {
  // Game discovery
  ipcMain.handle('get-games', async (_event, league?: string) => {
    return getGames(league as LeagueId | undefined)
  })

  // Channel discovery
  ipcMain.handle('get-channels', async (_event) => {
    return getChannels()
  })

  // Runs a discovery pass on demand (rather than waiting for the next
  // scheduled one) and returns the refreshed list. Without a pool — there
  // shouldn't be one in practice, since index.ts always constructs it before
  // registering handlers — falls back to whatever's already stored.
  ipcMain.handle('refresh-channels', async (_event) => {
    if (!pool) return getChannels()
    return discoverOnce(pool, getAllAdapters)
  })

  // Guide: serves the last guide index.ts's refresh loop built (shared via
  // channels/listings.ts), building one now only if none exists yet — e.g. a
  // renderer asking before startup's first refresh has completed. This is
  // the one place that no longer independently calls buildGuide itself, so
  // it can't race index.ts's own refresh and push a second, redundant
  // TVmaze fetch. getOrBuildGuide never throws (buildGuide's fetchTvmaze
  // swallows its own failures), so no try/catch is needed here.
  ipcMain.handle('get-guide', async (_event) => {
    return getOrBuildGuide({ channels: getChannels(), games: getGames() })
  })

  // Playback control
  ipcMain.handle('play-game', async (_event, gameId: string) => {
    console.log(`[IPC] play-game called for ${gameId}`)

    const result = await playbackManager.play(gameId)
    console.log(`[IPC] play-game result:`, JSON.stringify(result).slice(0, 300))
    return result
  })

  // Automatic failover. The renderer calls this when its stall machine times
  // out or a fatal error classifies as failover-worthy; main calls it directly
  // for failures it detects itself.
  ipcMain.handle('switch-stream', async (_event, gameId: string, reason?: string) => {
    return playbackManager.failover(gameId, reason ?? 'manual')
  })

  // Manual override from SourceSwitcher.
  ipcMain.handle('select-stream', async (_event, candidateId: string) => {
    return playbackManager.selectStream(candidateId)
  })

  ipcMain.handle('stop-playback', async (_event) => {
    playbackManager.stop()
  })

  ipcMain.handle('report-event', async (_event, eventData: { type: string; gameId: string; sourceId?: string; reason?: string; details?: Record<string, unknown> }) => {
    playbackManager.reportEvent({
      type: eventData.type as PlaybackEventType,
      gameId: eventData.gameId,
      sourceId: eventData.sourceId,
      details: eventData.details ?? (eventData.reason ? { reason: eventData.reason } : undefined),
    })
  })

  // Source management
  ipcMain.handle('get-sources', async (_event) => {
    return getSources()
  })

  ipcMain.handle('get-candidates', async (_event, gameId: string) => {
    return getCacheEntries(gameId)
  })

  ipcMain.handle('get-diagnostics', async (_event) => {
    const sources = getSources()
    const recentEvents = getRecentEvents(50)
    return {
      sources,
      recentProbes: [],
      recentFailures: recentEvents.filter(e => e.eventType.includes('fail')),
      unimplementedSources: [],
      recentEvents,
    }
  })

  ipcMain.handle('update-source', async (_event, sourceId: string, patch: Partial<Source>) => {
    updateSource(sourceId, patch)
  })

  ipcMain.handle('add-source', async (_event, source: Source) => {
    addSource(source)
  })

  // Bulk entry: accepts pasted text, one source per line. Returns a per-line
  // outcome so the UI can report what landed and what was skipped.
  ipcMain.handle('add-sources-bulk', async (_event, text: string) => {
    return addSourcesBulk(text)
  })

  // Dev fixture control (ONAIR_FIXTURE=1 only). Injects a failure into the
  // playing stream so the ladder can be watched rather than inferred.
  ipcMain.handle('fixture-set-mode', async (_event, mode: string) => {
    if (!isFixtureModeEnabled()) return { ok: false as const, reason: 'fixture_disabled' as const }
    setFixtureMode(mode as FailureMode)
    return { ok: true as const, mode }
  })

  ipcMain.handle('fixture-status', async () => {
    return { enabled: isFixtureModeEnabled(), mode: getFixtureMode() }
  })
}
