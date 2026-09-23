export const app = {
  getPath: (_name: string) => '/tmp/onair-test',
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {}
}
export const ipcMain = {
  handle: () => {},
  removeHandler: () => {}
}
export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => {},
  removeListener: () => {}
}
export const contextBridge = {
  exposeInMainWorld: () => {}
}
export const BrowserWindow = jest.fn().mockImplementation(() => ({
  contentView: {
    addChildView: jest.fn(),
    removeChildView: jest.fn(),
  },
  webContents: {
    send: jest.fn(),
    setWindowOpenHandler: jest.fn(),
  },
  on: jest.fn(),
  loadURL: jest.fn(),
  loadFile: jest.fn(),
  show: jest.fn(),
  getContentSize: jest.fn().mockReturnValue([1280, 800]),
}))
export const shell = { openExternal: () => {} }
// Keep these webRequest members in step with the hooks registered in
// src/main/playback/cors.ts and adblock.ts — a missing member fails the
// suite with "is not a function" rather than a useful assertion.
const makeWebRequest = () => ({
  onHeadersReceived: jest.fn(),
  onBeforeRequest: jest.fn(),
  onBeforeSendHeaders: jest.fn(),
})
export const session = {
  defaultSession: {
    webRequest: makeWebRequest(),
  },
  fromPartition: (_name: string) => ({
    webRequest: makeWebRequest(),
  })
}
export class WebContentsView {
  // Mirrors the webContents surface used by src/main/playback/webview.ts.
  webContents = {
    loadURL: jest.fn(),
    close: jest.fn(),
    setWindowOpenHandler: jest.fn(),
    executeJavaScript: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  }
  setBounds = jest.fn()
  constructor(_opts?: unknown) {}
}
