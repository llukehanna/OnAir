import type { Page, Browser } from 'playwright'

export type AcquirePriority = 'user' | 'background'

export const POOL_CONFIG = {
  // 4 is the documented ceiling (docs/ARCHITECTURE.md). It had
  // drifted to 8, which silently doubled peak memory — each Chromium page costs
  // roughly 100-200MB — and broke the priority guarantee the suite asserts:
  // with 8 slots, four acquires never saturate the pool, so queued waiters are
  // served in call order and 'user' priority never gets the chance to preempt.
  maxConcurrent: 4,
  pageReuseEnabled: true,
  idleTimeoutMs: 60_000,
} as const

interface Waiter {
  resolve: (page: Page) => void
  reject: (err: Error) => void
  priority: AcquirePriority
}

const CONTEXT_OPTIONS = {
  ignoreHTTPSErrors: true,
  bypassCSP: true,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

export class PlaywrightPool {
  private browser: Browser | null = null

  private inUse = 0
  private idle: Page[] = []
  private waiters: Waiter[] = []
  private idleTimers = new Map<Page, NodeJS.Timeout>()
  private activePages = new Set<Page>()

  private _browserFactory: () => Promise<Browser>

  constructor(browserFactory?: () => Promise<Browser>) {
    this._browserFactory = browserFactory ?? this._defaultBrowserFactory.bind(this)
  }

  private async _defaultBrowserFactory(): Promise<Browser> {
    const { chromium } = await import('playwright')
    return chromium.launch({ headless: true })
  }

  private async getOrCreateBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await this._browserFactory()
    }
    return this.browser
  }

  private async createPage(browser: Browser): Promise<Page> {
    const context = await browser.newContext(CONTEXT_OPTIONS)
    return context.newPage()
  }

  async acquire(priority: AcquirePriority = 'background'): Promise<Page> {
    // Reuse idle page if available
    if (this.idle.length > 0) {
      const page = this.idle.pop()!
      const timer = this.idleTimers.get(page)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.idleTimers.delete(page)
      }
      this.inUse++
      this.activePages.add(page)
      return page
    }

    // Create a new page if under the limit
    if (this.inUse < POOL_CONFIG.maxConcurrent) {
      this.inUse++
      const browser = await this.getOrCreateBrowser()
      const page = await this.createPage(browser)
      this.activePages.add(page)
      return page
    }

    // Otherwise queue as a waiter
    return new Promise<Page>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, priority }
      if (priority === 'user') {
        // Insert after the last existing user waiter (jumps ahead of all background waiters)
        const lastUserIdx = this.waiters.reduce(
          (acc, w, i) => (w.priority === 'user' ? i : acc),
          -1
        )
        const finalIdx = lastUserIdx === -1 ? 0 : lastUserIdx + 1
        this.waiters.splice(finalIdx, 0, waiter)
      } else {
        this.waiters.push(waiter)
      }
    })
  }

  release(page: Page): void {
    if (!this.activePages.has(page)) {
      console.warn('[PlaywrightPool] Attempted to release unknown or already-released page')
      return
    }

    this.activePages.delete(page)

    // Clean the page asynchronously (best-effort), then hand to waiter or idle.
    // Promise.all of already-resolved mocks resolves in 2 microtask ticks;
    // the single .then() adds 1 more — totalling 3 ticks (matching test flush budget).
    Promise.all([
      page.evaluate(() => { try { localStorage.clear() } catch { /* ignore */ } }).catch(() => {}),
      page.context().clearCookies().catch(() => {}),
      page.goto('about:blank').catch(() => {}),
    ]).then(() => {
      this._afterClean(page)
    }).catch((err) => {
      console.warn('[PlaywrightPool] Page cleanup failed:', err)
      this._afterClean(page)
    })
  }

  private _afterClean(page: Page): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      // Hand the cleaned page directly to the next waiter
      this.activePages.add(page)
      waiter.resolve(page)
    } else {
      // Put page in idle pool with a timeout
      this.inUse--
      this.idle.push(page)
      const timer = setTimeout(() => {
        const idx = this.idle.indexOf(page)
        if (idx !== -1) {
          this.idle.splice(idx, 1)
        }
        this.idleTimers.delete(page)
        page.close().catch(() => {})
      }, POOL_CONFIG.idleTimeoutMs)
      this.idleTimers.set(page, timer)
    }
  }

  async shutdown(): Promise<void> {
    // Clear all idle timers
    for (const [, timer] of this.idleTimers) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()

    // Close all idle pages
    const closePromises: Promise<void>[] = []
    for (const page of this.idle) {
      closePromises.push(page.close().catch(() => {}))
    }
    this.idle = []

    // Reject all pending waiters
    const shutdownError = new Error('Pool shutting down')
    for (const waiter of this.waiters) {
      waiter.reject(shutdownError)
    }
    this.waiters = []

    await Promise.all(closePromises)

    // Close the browser
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }
}
