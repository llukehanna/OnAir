// ---------------------------------------------------------------------------
// Mock electron BEFORE imports so hoisting works correctly.
// Use a factory that creates fresh mocks per test via module-level containers.
// ---------------------------------------------------------------------------

// These are defined before the mock factory runs (jest hoists mock to top)
// but we use a closure approach with a shared mocks object.

const mocks = {
  close: jest.fn(),
  loadURL: jest.fn(),
  setBounds: jest.fn(),
  addChildView: jest.fn(),
  removeChildView: jest.fn(),
  setWindowOpenHandler: jest.fn(),
  executeJavaScript: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  lastCreatedView: null as unknown,
}

jest.mock('electron', () => {
  class MockWebContentsView {
    // Must cover every webContents member createWebView touches, or the
    // suite fails with "is not a function" instead of a real assertion.
    webContents = {
      loadURL: mocks.loadURL,
      close: mocks.close,
      setWindowOpenHandler: mocks.setWindowOpenHandler,
      executeJavaScript: mocks.executeJavaScript,
      on: mocks.on,
    }
    setBounds = mocks.setBounds

    constructor(_opts?: unknown) {
      mocks.lastCreatedView = this
    }
  }
  return {
    WebContentsView: MockWebContentsView,
    BrowserWindow: class {},
  }
})

import { createWebView, destroyWebView, getActiveView, resetWebView } from '../../src/main/playback/webview'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWindow() {
  return {
    contentView: {
      addChildView: mocks.addChildView,
      removeChildView: mocks.removeChildView,
    },
  } as unknown as import('electron').BrowserWindow
}

const defaultBounds = { x: 0, y: 0, width: 800, height: 600 }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebContentsView lifecycle', () => {
  beforeEach(() => {
    resetWebView()
    mocks.lastCreatedView = null
    mocks.close.mockClear()
    mocks.loadURL.mockClear()
    mocks.setBounds.mockClear()
    mocks.addChildView.mockClear()
    mocks.removeChildView.mockClear()
  })

  it('createWebView creates a WebContentsView instance', () => {
    const win = makeMockWindow()
    createWebView(win, 'https://example.com/stream', defaultBounds)
    expect(mocks.lastCreatedView).not.toBeNull()
  })

  it('createWebView calls mainWindow.contentView.addChildView(view)', () => {
    const win = makeMockWindow()
    createWebView(win, 'https://example.com/stream', defaultBounds)
    expect(mocks.addChildView).toHaveBeenCalledTimes(1)
    expect(mocks.addChildView).toHaveBeenCalledWith(mocks.lastCreatedView)
  })

  it('createWebView calls view.setBounds with provided bounds', () => {
    const win = makeMockWindow()
    const bounds = { x: 10, y: 20, width: 1280, height: 720 }
    createWebView(win, 'https://example.com/stream', bounds)
    expect(mocks.setBounds).toHaveBeenCalledWith(bounds)
  })

  it('createWebView calls view.webContents.loadURL with the provided URL', () => {
    const win = makeMockWindow()
    const url = 'https://cdn.example.com/stream.m3u8'
    createWebView(win, url, defaultBounds)
    expect(mocks.loadURL).toHaveBeenCalledWith(url)
  })

  it('destroyWebView calls mainWindow.contentView.removeChildView(view)', () => {
    const win = makeMockWindow()
    createWebView(win, 'https://example.com/stream', defaultBounds)
    const view = mocks.lastCreatedView
    destroyWebView(win)
    expect(mocks.removeChildView).toHaveBeenCalledTimes(1)
    expect(mocks.removeChildView).toHaveBeenCalledWith(view)
  })

  it('destroyWebView calls view.webContents.close()', () => {
    const win = makeMockWindow()
    createWebView(win, 'https://example.com/stream', defaultBounds)
    destroyWebView(win)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })

  it('destroyWebView with no active view is a safe no-op', () => {
    const win = makeMockWindow()
    // No createWebView call — activeView is null
    expect(() => destroyWebView(win)).not.toThrow()
    expect(mocks.removeChildView).not.toHaveBeenCalled()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('calling createWebView when a view already exists destroys the old one first', () => {
    const win = makeMockWindow()
    createWebView(win, 'https://cdn.example.com/stream1.m3u8', defaultBounds)
    const firstView = mocks.lastCreatedView

    mocks.close.mockClear()
    mocks.addChildView.mockClear()
    mocks.removeChildView.mockClear()

    createWebView(win, 'https://cdn.example.com/stream2.m3u8', defaultBounds)

    // Old view should have been removed and closed
    expect(mocks.removeChildView).toHaveBeenCalledWith(firstView)
    expect(mocks.close).toHaveBeenCalledTimes(1)

    // New view should be added
    expect(mocks.addChildView).toHaveBeenCalledTimes(1)
    expect(mocks.addChildView).toHaveBeenCalledWith(mocks.lastCreatedView)
    expect(mocks.lastCreatedView).not.toBe(firstView)
  })

  it('getActiveView returns the current WebContentsView or null', () => {
    const win = makeMockWindow()
    expect(getActiveView()).toBeNull()
    createWebView(win, 'https://example.com/stream', defaultBounds)
    expect(getActiveView()).toBe(mocks.lastCreatedView)
    destroyWebView(win)
    expect(getActiveView()).toBeNull()
  })
})
