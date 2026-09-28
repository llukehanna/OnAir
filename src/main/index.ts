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
import { startWarmer, stopWarmer, onGamesUpdated } from './engine/warmer'
import { PlaywrightPool } from './adapters/pool'
import { register } from './adapters/registry'
import { registerBuiltinSources } from './adapters/sources'
import { setupCors } from './playback/cors'
import { initAdBlock, stopAdBlock } from './playback/adblock'
import { PlaybackManager } from './playback/manager'
import { getStreamCandidates } from './engine/index'

let pool: PlaywrightPool | null = null
let playbackManager: PlaybackManager | null = null

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
    undefined, // getGameFn — default
    undefined, // getCacheEntriesFn — default
    undefined, // classifyEntryFn — default
    undefined, // validateStaleFn — default
    (game) => getStreamCandidates(game, pool ?? undefined), // bind pool
  )

  // 6. Register IPC handlers (pass playbackManager)
  registerHandlers(playbackManager)

  // 7. Start discovery
  startDiscovery(win, (update) => onGamesUpdated(update, pool ?? undefined))

  // 7.5 Start pre-warmer (subscribes to games-updated via callback above)
  startWarmer(pool ?? undefined)

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
  pool?.shutdown()
  closeDb()
})
