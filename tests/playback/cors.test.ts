import { session } from 'electron'

// Reset modules before each test to get a fresh module state
beforeEach(() => {
  jest.clearAllMocks()
})

describe('setupCors', () => {
  it('registers onHeadersReceived on session.defaultSession.webRequest', async () => {
    const { setupCors } = await import('../../src/main/playback/cors')
    setupCors()
    expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1)
  })

  it('callback adds Access-Control-Allow-Origin: * to responseHeaders', async () => {
    const { setupCors } = await import('../../src/main/playback/cors')

    let capturedCallback: ((details: unknown, callback: (r: unknown) => void) => void) | undefined

    ;(session.defaultSession.webRequest.onHeadersReceived as jest.Mock).mockImplementation(
      (cb: (details: unknown, callback: (r: unknown) => void) => void) => {
        capturedCallback = cb
      }
    )

    setupCors()

    expect(capturedCallback).toBeDefined()

    const callbackResult = await new Promise<Record<string, unknown>>((resolve) => {
      capturedCallback!(
        { responseHeaders: { 'Content-Type': ['text/html'] } },
        (result) => resolve(result as Record<string, unknown>)
      )
    })

    const headers = callbackResult['responseHeaders'] as Record<string, string[]>
    expect(headers['Access-Control-Allow-Origin']).toEqual(['*'])
  })

  it('callback adds Access-Control-Allow-Methods to responseHeaders', async () => {
    const { setupCors } = await import('../../src/main/playback/cors')

    let capturedCallback: ((details: unknown, callback: (r: unknown) => void) => void) | undefined

    ;(session.defaultSession.webRequest.onHeadersReceived as jest.Mock).mockImplementation(
      (cb: (details: unknown, callback: (r: unknown) => void) => void) => {
        capturedCallback = cb
      }
    )

    setupCors()

    const callbackResult = await new Promise<Record<string, unknown>>((resolve) => {
      capturedCallback!(
        { responseHeaders: {} },
        (result) => resolve(result as Record<string, unknown>)
      )
    })

    const headers = callbackResult['responseHeaders'] as Record<string, string[]>
    expect(headers['Access-Control-Allow-Methods']).toEqual(['GET, HEAD, OPTIONS'])
  })

  it('callback works when responseHeaders is undefined in details', async () => {
    const { setupCors } = await import('../../src/main/playback/cors')

    let capturedCallback: ((details: unknown, callback: (r: unknown) => void) => void) | undefined

    ;(session.defaultSession.webRequest.onHeadersReceived as jest.Mock).mockImplementation(
      (cb: (details: unknown, callback: (r: unknown) => void) => void) => {
        capturedCallback = cb
      }
    )

    setupCors()

    const callbackResult = await new Promise<Record<string, unknown>>((resolve) => {
      capturedCallback!(
        { responseHeaders: undefined },
        (result) => resolve(result as Record<string, unknown>)
      )
    })

    const headers = callbackResult['responseHeaders'] as Record<string, string[]>
    expect(headers).toBeDefined()
    expect(headers['Access-Control-Allow-Origin']).toEqual(['*'])
    expect(headers['Access-Control-Allow-Methods']).toEqual(['GET, HEAD, OPTIONS'])
  })

  it('callback works when responseHeaders is null in details', async () => {
    const { setupCors } = await import('../../src/main/playback/cors')

    let capturedCallback: ((details: unknown, callback: (r: unknown) => void) => void) | undefined

    ;(session.defaultSession.webRequest.onHeadersReceived as jest.Mock).mockImplementation(
      (cb: (details: unknown, callback: (r: unknown) => void) => void) => {
        capturedCallback = cb
      }
    )

    setupCors()

    const callbackResult = await new Promise<Record<string, unknown>>((resolve) => {
      capturedCallback!(
        { responseHeaders: null },
        (result) => resolve(result as Record<string, unknown>)
      )
    })

    const headers = callbackResult['responseHeaders'] as Record<string, string[]>
    expect(headers).toBeDefined()
    expect(headers['Access-Control-Allow-Origin']).toEqual(['*'])
  })
})
