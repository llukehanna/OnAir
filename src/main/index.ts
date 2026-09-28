import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDb, closeDb } from './db/connection'
import { runMigrations } from './db/migrations'
import { runMaintenance, vacuumIfNeeded } from './db/maintenance'
import {
  FixtureAdapter,
  isFixtureModeEnabled,
  startFixtureServers,
  stopFixtureServers,
  upsertFixtureSource,
} from './dev/fixture-adapter'
import { registerHandlers } from './ipc/handlers'
import { startDiscovery, stopDiscovery } from './discovery/scheduler'
import { startChannelDiscovery, stopChannelDiscovery } from './channels/scheduler'
import { buildGuide } from './channels/listings'
import { getChannels } from './db/queries/channels'
import { getGames } from './db/queries/games'
import { startWarmer, stopWarmer, onGamesUpdated } from './engine/warmer'
import { PlaywrightPool } from './adapters/pool'
import { register, getAllAdapters } from './adapters/registry'
import { registerBuiltinSources } from './adapters/sources'
import { setupCors } from './playback/cors'
import { initAdBlock, stopAdBlock } from './playback/adblock'
import { PlaybackManager } from './playback/manager'
import { getStreamCandidates } from './engine/index'

const GUIDE_REFRESH_INTERVAL_MS = 30 * 60_000

let pool: PlaywrightPool | null = null
let playbackManager: PlaybackManager | null = null
let guideIntervalHandle: ReturnType<typeof setInterval> | null = null

// refreshGuide is triggered from four independent places (startup, every
// games-updated, every channels-updated, and a 30-min timer) which can fire
// within milliseconds of each other — most obviously at startup, when all
// three non-timer triggers fire almost together. Without coordination that
// means several concurrent buildGuide() calls (each doing up to 2 TVmaze
// GETs) racing each other, and — since nothing orders their completion —
// an earlier-started, later-finishing call can push its now-stale guide
// over a fresher one that resolved first.
//
// guideRefreshInFlight/guideRefreshDirty turn every trigger into: run now if
// idle, otherwise just mark dirty and return. The in-flight run, once done,
// re-runs immediately if it was marked dirty meanwhile, and keeps doing so
// until a run finishes with nothing new queued. That guarantees at most one
// buildGuide() in flight at a time, and that the LAST trigger to arrive is
// always the one whose data ends up pushed (never overwritten by an older
// run finishing late).
let guideRefreshInFlight = false
let guideRefreshDirty = false

/**
 * Rebuilds the guide and pushes it to the window, coalescing concurrent
 * triggers per the comment above. Never throws — buildGuide itself never
 * rejects (fetchTvmaze swallows its own failures), but this is the one
 * refresh that must not be allowed to take the app down regardless, since
 * it's also called from the games/channels update callbacks.
 */
async function refreshGuide(win: BrowserWindow): Promise<void> {
  if (guideRefreshInFlight) {
    guideRefreshDirty = true
    return
  }

  guideRefreshInFlight = true
  try {
    do {
      guideRefreshDirty = false
      try {
        const guide = await buildGuide({ channels: getChannels(), games: getGames() })
        if (!win.isDestroyed()) win.webContents.send('guide-updated', guide)
      } catch (err) {
        console.warn('[guide] refresh failed:', err)
      }
    } while (guideRefreshDirty)
  } finally {
    guideRefreshInFlight = false
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Traffic lights sit inside the renderer's own top bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 22 },
    backgroundColor: '#0b0b0c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false, // Allow cross-origin stream requests from hls.js
    }
  })

  win.on('ready-to-show', () => win.show())

  // Debug: log renderer console messages and errors
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 1) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  // Packaged builds get the icon from the bundle; in dev the Dock would
  // otherwise show Electron's default.
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  // 0. CORS injection — MUST be before window creation
  setupCors()

  // 0.5. Ad blocking init — async, non-blocking (fire and forget)
  initAdBlock().catch(err => console.warn('adblock init failed:', err))

  // 1. Initialize database (opens connection, sets WAL pragmas)
  getDb()

  // 2. Run migrations (creates tables, seeds data — idempotent)
  runMigrations()

  // 2.5 Prune stale rows and reclaim space. Nothing pruned anything before
  //     this, so both games and events grew for the life of the install.
  try {
    const pruned = runMaintenance()
    if (pruned.gamesDeleted > 0 || pruned.eventsDeleted > 0) {
      console.log(
        `[startup] pruned ${pruned.gamesDeleted} games, ${pruned.eventsDeleted} events`
      )
    }
    if (vacuumIfNeeded()) console.log('[startup] vacuumed database')
  } catch (err) {
    // Maintenance is housekeeping — never let it block launch.
    console.warn('[startup] maintenance skipped:', err)
  }

  // 3. Create PlaywrightPool (before IPC handlers so handlers can reference it)
  pool = new PlaywrightPool()

  // The pool launches Chromium lazily, on the first adapter that asks for a
  // page, so a session with only the fixture source never starts a browser.

  // 3.5 Register source adapters (after pool, before handlers). Built-in
  //     third-party sources live in adapters/sources/; each is config-driven
  //     on the shared InterceptAdapter base and seeds its own sources row.
  registerBuiltinSources()

  // 3.6 Dev fixture source (ONAIR_FIXTURE=1 only). Serves two local HLS streams
  //     so the full pipeline can be exercised in the real UI with no external
  //     source, and failures injected on command instead of waited for.
  if (isFixtureModeEnabled()) {
    await startFixtureServers()
    upsertFixtureSource()
    register(new FixtureAdapter())
    console.log('[startup] dev fixture source registered')
  }

  // 5. Create window (renderer can now safely call window.onair methods)
  const win = createWindow()

  // 5.5. Create PlaybackManager (needs window reference and pool for Playwright extraction)
  playbackManager = new PlaybackManager(
    win,
    undefined, // getTargetFn — default (resolveTarget)
    undefined, // getCacheEntriesFn — default
    undefined, // classifyEntryFn — default
    undefined, // validateStaleFn — default
    (target) => getStreamCandidates(target, pool ?? undefined), // bind pool
  )

  // 6. Register IPC handlers (pass playbackManager and the pool, for refresh-channels)
  registerHandlers(playbackManager, pool ?? undefined)

  // 7. Start discovery
  startDiscovery(win, (update) => {
    onGamesUpdated(update, pool ?? undefined)
    void refreshGuide(win) // games changed — the guide's game rows may be stale
  })

  // 7.5 Start pre-warmer (subscribes to games-updated via callback above)
  startWarmer(pool ?? undefined)

  // 7.6 Start channel discovery: run now, then every 30 minutes, over every
  //     registered adapter (built-ins plus the dev fixture when enabled).
  //     getAllAdapters is passed by reference (not called here) so the
  //     scheduler always reads the registry's current contents each pass.
  if (pool) {
    startChannelDiscovery(pool, getAllAdapters, (channels) => {
      if (!win.isDestroyed()) win.webContents.send('channels-updated', channels)
      void refreshGuide(win) // channel set changed — known-channel filtering may differ
    })
  }

  // 7.7 Start the guide's own refresh timer. Games/channels updates above
  //     already trigger a refresh; this catches TVmaze's schedule moving on
  //     its own (a show starting/ending) between those events.
  void refreshGuide(win)
  guideIntervalHandle = setInterval(() => void refreshGuide(win), GUIDE_REFRESH_INTERVAL_MS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  playbackManager?.stop()   // LIFO: destroy active playback first
  stopAdBlock()             // LIFO: clean up ad blocking
  stopWarmer()
  void stopFixtureServers()  // no-op unless fixture mode was enabled
  stopDiscovery()
  stopChannelDiscovery()
  if (guideIntervalHandle !== null) {
    clearInterval(guideIntervalHandle)
    guideIntervalHandle = null
  }
  pool?.shutdown()
  closeDb()
})
