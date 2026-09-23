import path from 'node:path'
import fs from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { startHlsFixture, type HlsFixture } from '../../src/main/dev/hls-fixture'

// ---------------------------------------------------------------------------
// The never-black proof.
//
// Everything else in the failover suite proves the decisions are right — which candidate,
// when to switch, how to classify a failure. None of it proves the picture
// survives the switch. That needs a real decoder, so this tier runs Chromium
// with hls.js against real MPEG-TS segments.
//
// Scope, stated honestly: this exercises the dual-video staging technique that
// usePlayback implements, not the React hook itself. Driving the actual hook
// would require booting the Electron app. What is proven here is that the
// technique holds the invariant; what remains unproven is that the hook wires
// it correctly, which the manager-level and unit suites cover from the other
// side.
//
// These are slow (seconds, not milliseconds) and excluded from the default
// suite. Run with: npm run test:browser
// ---------------------------------------------------------------------------

const MEDIA_A = path.join(__dirname, '..', 'fixtures', 'media', 'a')
const MEDIA_B = path.join(__dirname, '..', 'fixtures', 'media', 'b')
const HLS_JS = path.join(__dirname, '..', '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js')

jest.setTimeout(90_000)

/** Mirrors the staging-and-swap contract in src/renderer/src/hooks/usePlayback.ts. */
const HARNESS = `
window.__onair = {
  samples: [],
  activeSlot: 0,
  players: [null, null],
  videos: [document.getElementById('v0'), document.getElementById('v1')],

  activeVideo() { return this.videos[this.activeSlot] },
  stagingVideo() { return this.videos[1 - this.activeSlot] },

  // Samples the ACTIVE element only. That is the one the viewer is looking at,
  // and the invariant is about what they see.
  startSampling() {
    this.sampler = setInterval(() => {
      const v = this.activeVideo()
      this.samples.push({ t: performance.now(), slot: this.activeSlot, readyState: v.readyState, currentTime: v.currentTime })
    }, 50)
  },
  stopSampling() { clearInterval(this.sampler) },

  load(slot, url) {
    return new Promise((resolve, reject) => {
      const video = this.videos[slot]
      const hls = new Hls({ maxBufferLength: 30 })
      this.players[slot] = hls
      const fail = setTimeout(() => reject(new Error('timeout waiting for frag')), 30000)
      hls.on(Hls.Events.FRAG_CHANGED, () => { clearTimeout(fail); resolve(true) })
      hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) { clearTimeout(fail); reject(new Error(d.details)) } })
      hls.loadSource(url)
      hls.attachMedia(video)
      video.play().catch(() => {})
    })
  },

  // The swap: staging is fully ready BEFORE the old stream is torn down.
  swap() {
    const outgoing = this.activeSlot
    this.activeSlot = 1 - outgoing
    this.videos[this.activeSlot].style.visibility = 'visible'
    this.videos[outgoing].style.visibility = 'hidden'
    if (this.players[outgoing]) { this.players[outgoing].destroy(); this.players[outgoing] = null }
  },
}
`

async function newHarnessPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent(`
    <body style="margin:0;background:#000">
      <video id="v0" muted playsinline style="position:absolute;width:320px;height:180px"></video>
      <video id="v1" muted playsinline style="position:absolute;width:320px;height:180px;visibility:hidden"></video>
    </body>
  `)
  await page.addScriptTag({ content: fs.readFileSync(HLS_JS, 'utf8') })
  await page.addScriptTag({ content: HARNESS })
  return page
}

describe('never-black invariant', () => {
  let browser: Browser
  let a: HlsFixture
  let b: HlsFixture
  let page: Page

  beforeAll(async () => {
    if (!fs.existsSync(MEDIA_A)) throw new Error(`missing test media at ${MEDIA_A}`)
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
  })

  beforeEach(async () => {
    a = await startHlsFixture({ mediaDir: MEDIA_A, windowSize: 6 })
    b = await startHlsFixture({ mediaDir: MEDIA_B, windowSize: 6 })
    page = await newHarnessPage(browser)
  })

  afterEach(async () => {
    await page?.close()
    await a?.close()
    await b?.close()
  })

  it('plays real media from the fixture at all', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.waitForTimeout(600)
    const state = await page.evaluate(() => ({
      readyState: window.__onair.activeVideo().readyState,
      currentTime: window.__onair.activeVideo().currentTime,
    }))
    expect(state.readyState).toBeGreaterThanOrEqual(2)
    expect(state.currentTime).toBeGreaterThan(0)
  })

  it('keeps the visible element above readyState 2 across a swap', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.evaluate(() => window.__onair.startSampling())
    await page.waitForTimeout(400)

    // Stage the replacement, then swap only once it has produced a frame.
    await page.evaluate((url) => window.__onair.load(1, url), b.masterUrl)
    await page.evaluate(() => window.__onair.swap())
    await page.waitForTimeout(600)

    const samples = await page.evaluate(() => {
      window.__onair.stopSampling()
      return window.__onair.samples
    })

    expect(samples.length).toBeGreaterThan(5)
    const starved = samples.filter((s) => s.readyState < 2)
    expect(starved).toEqual([])
  })

  it('advances playback position monotonically across a swap', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.evaluate(() => window.__onair.startSampling())
    await page.waitForTimeout(400)
    await page.evaluate((url) => window.__onair.load(1, url), b.masterUrl)
    await page.evaluate(() => window.__onair.swap())
    await page.waitForTimeout(600)

    const samples = await page.evaluate(() => {
      window.__onair.stopSampling()
      return window.__onair.samples
    })

    // The incoming element carries its own timeline, so position is compared
    // only within a run of samples from the same slot. What must never happen
    // is time running backwards while the viewer is on one element.
    //
    // Continuity ACROSS the boundary is deliberately not asserted here: the two
    // sources sit at different distances behind live, and reconciling that is
    // plan 4 (PDT alignment, backward-jump clamp). Asserting it now would
    // encode a guarantee nothing implements yet.
    let regressions = 0
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].slot !== samples[i - 1].slot) continue
      if (samples[i].currentTime < samples[i - 1].currentTime) regressions++
    }
    expect(regressions).toBe(0)
  })

  it('carries volume and mute onto the incoming element', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      window.__onair.activeVideo().volume = 0.42
      window.__onair.activeVideo().muted = false
    })

    await page.evaluate((url) => window.__onair.load(1, url), b.masterUrl)
    await page.evaluate(() => {
      // Mirrors the carry-over usePlayback performs before making the swap.
      const outgoing = window.__onair.activeVideo()
      const incoming = window.__onair.stagingVideo()
      incoming.volume = outgoing.volume
      incoming.muted = outgoing.muted
      window.__onair.swap()
    })

    const after = await page.evaluate(() => ({
      volume: window.__onair.activeVideo().volume,
      muted: window.__onair.activeVideo().muted,
    }))
    expect(after.volume).toBeCloseTo(0.42)
    expect(after.muted).toBe(false)
  })

  it('observes an actual slot change, so the swap assertions are not vacuous', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.evaluate(() => window.__onair.startSampling())
    await page.waitForTimeout(400)
    await page.evaluate((url) => window.__onair.load(1, url), b.masterUrl)
    await page.evaluate(() => window.__onair.swap())
    await page.waitForTimeout(400)

    const slots = await page.evaluate(() => {
      window.__onair.stopSampling()
      return window.__onair.samples.map((s) => s.slot)
    })
    expect(new Set(slots).size).toBe(2)
  })

  it('still shows the old stream while the replacement is still loading', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.waitForTimeout(400)

    // Begin staging but deliberately do not await it.
    await page.evaluate((url) => {
      window.__onair.load(1, url)
      return true
    }, b.masterUrl)

    const during = await page.evaluate(() => ({
      readyState: window.__onair.activeVideo().readyState,
      slot: window.__onair.activeSlot,
    }))

    // Still slot 0, still playing — the swap has not happened yet.
    expect(during.slot).toBe(0)
    expect(during.readyState).toBeGreaterThanOrEqual(2)
  })

  it('survives the outgoing stream dying mid-swap', async () => {
    await page.evaluate((url) => window.__onair.load(0, url), a.masterUrl)
    await page.evaluate(() => window.__onair.startSampling())
    await page.waitForTimeout(400)

    // Kill the source we are leaving, exactly as a real failover would find it.
    a.setMode('segment-403')

    await page.evaluate((url) => window.__onair.load(1, url), b.masterUrl)
    await page.evaluate(() => window.__onair.swap())
    await page.waitForTimeout(600)

    const after = await page.evaluate(() => {
      window.__onair.stopSampling()
      return {
        readyState: window.__onair.activeVideo().readyState,
        currentTime: window.__onair.activeVideo().currentTime,
      }
    })

    expect(after.readyState).toBeGreaterThanOrEqual(2)
    expect(after.currentTime).toBeGreaterThan(0)
  })
})
