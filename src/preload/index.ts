import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Expose Electron utilities to renderer
contextBridge.exposeInMainWorld('electron', electronAPI)

contextBridge.exposeInMainWorld('onair', {
  // === Invoke handlers (11 total) ===
  getGames: (league?: string) => ipcRenderer.invoke('get-games', league),
  playGame: (gameId: string) => ipcRenderer.invoke('play-game', gameId),
  switchStream: (gameId: string, reason?: string) =>
    ipcRenderer.invoke('switch-stream', gameId, reason),
  selectStream: (candidateId: string) => ipcRenderer.invoke('select-stream', candidateId),
  stopPlayback: () => ipcRenderer.invoke('stop-playback'),
  getSources: () => ipcRenderer.invoke('get-sources'),
  getCandidatesForGame: (gameId: string) => ipcRenderer.invoke('get-candidates', gameId),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  updateSource: (sourceId: string, patch: unknown) =>
    ipcRenderer.invoke('update-source', sourceId, patch),
  addSource: (source: unknown) => ipcRenderer.invoke('add-source', source),
  addSourcesBulk: (text: string) => ipcRenderer.invoke('add-sources-bulk', text),

  // Channels + guide
  getChannels: () => ipcRenderer.invoke('get-channels'),
  refreshChannels: () => ipcRenderer.invoke('refresh-channels'),
  getGuide: () => ipcRenderer.invoke('get-guide'),

  // Dev fixture controls — no-ops unless ONAIR_FIXTURE=1.
  fixtureSetMode: (mode: string) => ipcRenderer.invoke('fixture-set-mode', mode),
  fixtureStatus: () => ipcRenderer.invoke('fixture-status'),
  reportEvent: (event: { type: string; gameId: string; sourceId?: string; reason?: string; details?: Record<string, unknown> }) =>
    ipcRenderer.invoke('report-event', event),

  // === Push event subscriptions ===
  onGamesUpdated: (cb: (update: unknown) => void) => {
    const handler = (_: unknown, update: unknown) => cb(update)
    ipcRenderer.on('games-updated', handler)
    return () => {
      ipcRenderer.removeListener('games-updated', handler)
    }
  },
  onPlaybackEvent: (cb: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown) => cb(event)
    ipcRenderer.on('playback-event', handler)
    return () => {
      ipcRenderer.removeListener('playback-event', handler)
    }
  },
  onChannelsUpdated: (cb: (channels: unknown) => void) => {
    const handler = (_: unknown, channels: unknown) => cb(channels)
    ipcRenderer.on('channels-updated', handler)
    return () => {
      ipcRenderer.removeListener('channels-updated', handler)
    }
  },
  onGuideUpdated: (cb: (guide: unknown) => void) => {
    const handler = (_: unknown, guide: unknown) => cb(guide)
    ipcRenderer.on('guide-updated', handler)
    return () => {
      ipcRenderer.removeListener('guide-updated', handler)
    }
  }
})
