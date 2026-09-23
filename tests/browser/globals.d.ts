// The harness installs window.__onair inside the page. It is declared here so the
// page.evaluate callbacks typecheck without weakening them to `any` at each site.
interface OnAirHarnessSample {
  t: number
  /** Which video element was visible when this sample was taken. */
  slot: number
  readyState: number
  currentTime: number
}

interface OnAirHarness {
  samples: OnAirHarnessSample[]
  activeSlot: number
  activeVideo(): HTMLVideoElement
  stagingVideo(): HTMLVideoElement
  startSampling(): void
  stopSampling(): void
  load(slot: number, url: string): Promise<boolean>
  swap(): void
}

declare global {
  interface Window {
    __onair: OnAirHarness
  }
}

export {}
