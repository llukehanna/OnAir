import { WebContentsView, type BrowserWindow } from 'electron'

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let activeView: WebContentsView | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new WebContentsView, attaches it to mainWindow, sets bounds,
 * and loads the given URL.
 *
 * If a view is already active it is destroyed first (prevents stale GPU
 * resources on rapid stream switches).
 */
export function createWebView(
  mainWindow: BrowserWindow,
  url: string,
  bounds: { x: number; y: number; width: number; height: number }
): void {
  // Destroy existing view if any
  if (activeView) {
    destroyWebView(mainWindow)
  }

  activeView = new WebContentsView({
    webPreferences: {
      contextIsolation: false, // Allow script injection for autoplay
    },
  })
  mainWindow.contentView.addChildView(activeView)
  activeView.setBounds(bounds)
  activeView.webContents.loadURL(url)

  // Block popups and new window attempts from ad scripts
  activeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Inject script to remove "Initializing" overlays and unmute video.
  // Many streaming sites show a loading overlay on top of an already-playing video.
  const autoplayScript = `
    setInterval(() => {
      // Remove any overlay divs covering the player
      document.querySelectorAll('[class*="overlay"], [class*="loading"], [class*="initial"], [id*="overlay"], [id*="loading"]').forEach(el => {
        if (el.textContent?.includes('Initializing') || el.textContent?.includes('Setting up')) {
          el.style.display = 'none';
        }
      });
      // Unmute and play all video elements (including in iframes)
      document.querySelectorAll('video').forEach(v => { v.muted = false; v.play().catch(() => {}); });
      // Try in iframes too
      document.querySelectorAll('iframe').forEach(f => {
        try {
          f.contentDocument?.querySelectorAll('video').forEach(v => { v.muted = false; v.play().catch(() => {}); });
          f.contentDocument?.querySelectorAll('[class*="overlay"], [class*="loading"], [class*="initial"]').forEach(el => {
            if (el.textContent?.includes('Initializing') || el.textContent?.includes('Setting up')) {
              el.style.display = 'none';
            }
          });
        } catch {}
      });
    }, 2000);
  `
  // Run periodically — the stream page may take time to load its iframes
  activeView.webContents.on('did-finish-load', () => {
    activeView?.webContents.executeJavaScript(autoplayScript).catch(() => {})
  })
  // Also inject after 5s in case did-finish-load fires before iframes are ready
  setTimeout(() => {
    activeView?.webContents.executeJavaScript(autoplayScript).catch(() => {})
  }, 5000)
}

/**
 * Removes the active WebContentsView from mainWindow and closes its
 * WebContents to release GPU/renderer resources.
 *
 * Safe to call when no view exists — returns immediately.
 * Safe to call without a mainWindow — skips removeChildView, still closes.
 */
export function destroyWebView(mainWindow?: BrowserWindow): void {
  if (!activeView) return
  if (mainWindow) {
    mainWindow.contentView.removeChildView(activeView)
  }
  activeView.webContents.close()
  activeView = null
}

/**
 * Returns the currently active WebContentsView, or null if none exists.
 */
export function getActiveView(): WebContentsView | null {
  return activeView
}

/**
 * Resets module state for test isolation.
 * Same pattern as resetWarmerState().
 */
export function resetWebView(): void {
  activeView = null
}
