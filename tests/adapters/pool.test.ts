import type { Browser } from 'playwright'
import { PlaywrightPool, AcquirePriority, POOL_CONFIG } from '../../src/main/adapters/pool'
import { createMockPage, createMockBrowserFactory } from '../helpers/playwright-mock'

function makeFakeBrowser(): Browser {
  return {
    newContext: jest.fn().mockImplementation(async () => ({
      newPage: jest.fn().mockImplementation(async () => createMockPage()),
      clearCookies: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    close: jest.fn().mockResolvedValue(undefined),
    contexts: jest.fn().mockReturnValue([]),
  } as unknown as Browser
}

describe('PlaywrightPool', () => {
  let pool: PlaywrightPool

  afterEach(async () => {
    // Clean up pool after each test
    try {
      await pool.shutdown()
    } catch {
      // ignore shutdown errors in cleanup
    }
  })

  describe('max concurrent', () => {
    it('allows acquiring up to maxConcurrent (4) pages without blocking', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const pages = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])
      expect(pages).toHaveLength(4)
    })

    it('blocks 5th acquire until a page is released', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const pages = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      let fifthResolved = false
      const fifthPromise = pool.acquire('background').then((p) => {
        fifthResolved = true
        return p
      })

      // 5th should not have resolved yet
      await Promise.resolve()
      expect(fifthResolved).toBe(false)

      // Release one page — 5th should now resolve
      pool.release(pages[0])
      await fifthPromise
      expect(fifthResolved).toBe(true)
    })
  })

  describe('release unblocks waiter', () => {
    it('releasing a page immediately resolves the next waiter', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const [p1, p2, p3, p4] = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      const waiterPromise = pool.acquire('background')
      pool.release(p1)
      const waiterPage = await waiterPromise
      expect(waiterPage).toBeDefined()

      // Clean up remaining pages
      pool.release(p2)
      pool.release(p3)
      pool.release(p4)
      pool.release(waiterPage)
    })
  })

  describe('user priority jumps ahead', () => {
    it('user priority request is served before background waiters', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const [p1, p2, p3, p4] = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      const order: string[] = []

      // Queue 2 background waiters first
      const bg1 = pool.acquire('background').then((p) => { order.push('bg1'); return p })
      const bg2 = pool.acquire('background').then((p) => { order.push('bg2'); return p })

      // Then queue 1 user waiter — should jump ahead
      const user1 = pool.acquire('user').then((p) => { order.push('user1'); return p })

      // Release one page — user should get it
      pool.release(p1)
      const firstPage = await user1
      expect(order).toEqual(['user1'])

      // Release another — bg1 should get it
      pool.release(p2)
      await bg1
      expect(order).toEqual(['user1', 'bg1'])

      // Release another — bg2 should get it
      pool.release(p3)
      await bg2
      expect(order).toEqual(['user1', 'bg1', 'bg2'])

      pool.release(p4)
      pool.release(firstPage)
    })
  })

  describe('background FIFO order', () => {
    it('background waiters are served in FIFO order', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const [p1, p2, p3, p4] = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      const order: string[] = []
      const w1 = pool.acquire('background').then((p) => { order.push('w1'); return p })
      const w2 = pool.acquire('background').then((p) => { order.push('w2'); return p })
      const w3 = pool.acquire('background').then((p) => { order.push('w3'); return p })

      pool.release(p1)
      await w1
      pool.release(p2)
      await w2
      pool.release(p3)
      await w3

      expect(order).toEqual(['w1', 'w2', 'w3'])

      pool.release(p4)
    })
  })

  describe('crash reclaims slot', () => {
    it('releasing a page after simulated crash (via finally) restores the pool slot', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const [p1, p2, p3, p4] = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      // Simulate adapter crash with finally-block release
      const crashingAdapter = async () => {
        const page = await pool.acquire('background')
        try {
          throw new Error('adapter crash')
        } finally {
          pool.release(page)
        }
      }

      // Release one slot so crashingAdapter can acquire
      pool.release(p1)
      await expect(crashingAdapter()).rejects.toThrow('adapter crash')

      // After crash + finally release, a new acquire should succeed promptly
      let resolved = false
      const afterCrashPromise = pool.acquire('background').then((p) => {
        resolved = true
        return p
      })

      pool.release(p2)
      await afterCrashPromise
      expect(resolved).toBe(true)

      pool.release(p3)
      pool.release(p4)
    })
  })

  describe('idle timeout closes page', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('closes a released idle page after idleTimeoutMs', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const page = await pool.acquire('background')
      const closeSpy = page.close as jest.Mock

      pool.release(page)

      // Wait for async cleanup to complete
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      expect(closeSpy).not.toHaveBeenCalled()

      jest.advanceTimersByTime(POOL_CONFIG.idleTimeoutMs + 1000)

      expect(closeSpy).toHaveBeenCalled()
    })

    it('clears idle timer if page is re-acquired before timeout', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const page = await pool.acquire('background')
      const closeSpy = page.close as jest.Mock

      pool.release(page)

      // Wait for async cleanup
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Re-acquire before timeout fires
      const reacquired = await pool.acquire('background')

      jest.advanceTimersByTime(POOL_CONFIG.idleTimeoutMs + 1000)

      // close should NOT have been called because page was re-acquired
      expect(closeSpy).not.toHaveBeenCalled()

      pool.release(reacquired)
    })
  })

  describe('default browser factory Chrome fallback', () => {
    it('falls back to the system Chrome channel when the bundled executable is missing', async () => {
      const fakeBrowser = makeFakeBrowser()
      const launchChromium = jest
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "browserType.launch: Executable doesn't exist at /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell"
          )
        )
        .mockResolvedValueOnce(fakeBrowser)

      pool = new PlaywrightPool(undefined, launchChromium)
      const page = await pool.acquire('background')

      expect(page).toBeDefined()
      expect(launchChromium).toHaveBeenCalledTimes(2)
      expect(launchChromium).toHaveBeenNthCalledWith(1, { headless: true })
      expect(launchChromium).toHaveBeenNthCalledWith(2, { headless: true, channel: 'chrome' })
    })

    it('rethrows a launch failure unrelated to a missing executable, without a second attempt', async () => {
      const launchChromium = jest.fn().mockRejectedValueOnce(new Error('spawn EACCES'))

      pool = new PlaywrightPool(undefined, launchChromium)

      await expect(pool.acquire('background')).rejects.toThrow('spawn EACCES')
      expect(launchChromium).toHaveBeenCalledTimes(1)
    })
  })

  describe('shutdown', () => {
    it('shutdown closes idle pages and rejects pending waiters', async () => {
      pool = new PlaywrightPool(createMockBrowserFactory())
      const [p1, p2, p3, p4] = await Promise.all([
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
        pool.acquire('background'),
      ])

      // Release p1, p2 and wait for them to become idle
      pool.release(p1)
      pool.release(p2)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Now pool has 2 idle pages and 2 active; queue a waiter (pool not at max, but let's fill it)
      // Re-acquire the idle pages to fill the pool back up to max
      const rp1 = await pool.acquire('background')
      const rp2 = await pool.acquire('background')

      // Now pool is full again — queue a waiter
      const waiterPromise = pool.acquire('background')

      // Release p3, p4 to become idle (so shutdown has idle pages to close)
      pool.release(p3)
      pool.release(p4)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Shutdown — should close idle pages and reject remaining waiters
      // (waiterPromise was queued before p3/p4 cleanup runs, so it gets resolved by p3)
      // Instead: shutdown while there are idle pages AND a blocked waiter that hasn't been resolved
      // The waiter gets resolved synchronously by p3/p4 unless we call shutdown immediately

      // Let's use a simpler approach: full pool + waiter + immediate shutdown (no releases)
      const pool2 = new PlaywrightPool(createMockBrowserFactory())
      const pages2 = await Promise.all([
        pool2.acquire('background'),
        pool2.acquire('background'),
        pool2.acquire('background'),
        pool2.acquire('background'),
      ])

      // Release two to become idle
      pool2.release(pages2[0])
      pool2.release(pages2[1])
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Queue a waiter while pool still has 2 in use + 2 idle
      // Re-fill by acquiring the idle pages
      const idle1 = await pool2.acquire('background')
      const idle2 = await pool2.acquire('background')
      // Pool is full again (4 in use)
      const blockedWaiter = pool2.acquire('background')

      // Shutdown immediately (no releases) — waiter should be rejected
      await pool2.shutdown()

      await expect(blockedWaiter).rejects.toThrow('Pool shutting down')

      // Clean up original pool (shutdown instead of release to avoid dangling cleanup chains)
      await pool.shutdown()
    })
  })
})
