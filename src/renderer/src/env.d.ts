// Inline type definitions mirroring src/main/types.ts
// These must be kept in sync with the main process types.
// We cannot import from ../../main/types because it is outside the renderer's tsconfig project scope.

// CSS Module typings live in css-modules.d.ts — a wildcard `declare module`
// must be in an ambient (non-module) file, and this file is a module.

declare global {
  type LeagueId = 'nba' | 'nfl' | 'cbb' | 'cfb'

  type GameStatus = 'LIVE' | 'STARTING_SOON' | 'RECENTLY_ENDED' | 'SCHEDULED'

  type HealthState = 'healthy' | 'degraded' | 'blocked' | 'broken' | 'unknown'

  type StreamType = 'hls' | 'dash' | 'embedded'

  type PlaybackEventType =
    | 'stream_started'
    | 'stream_failed'
    | 'buffer_stall'
    | 'source_switch'
    | 'probe_result'
    | 'all_sources_failed'

  interface TeamInfo {
    abbr: string
    shortName: string
    color: string | null      // '#rrggbb' or null
    altColor: string | null   // '#rrggbb' or null
    logo: string | null       // absolute https URL
    score: number | null      // null before kickoff
    record: string | null     // e.g. '3-0'
  }

  interface Game {
    gameId: string
    league: LeagueId
    teamHome: string
    teamAway: string
    startTime: number
    status: GameStatus
    away?: TeamInfo
    home?: TeamInfo
    statusDetail?: string     // ESPN status.type.shortDetail, e.g. 'Q3 - 4:12', 'Halftime', 'Final'
    network?: string          // first broadcast name, e.g. 'NBC'
    venue?: string
  }

  interface Source {
    sourceId: string
    name: string
    baseUrl: string
    confidenceWeight: number
    healthState: HealthState
    healthUpdatedAt: number | null
    enabled: boolean
    needsAdapter: boolean
    addedAt: number
  }

  interface StreamCandidate {
    candidateId: string
    gameId: string
    sourceId: string
    streamUrl: string
    streamType: StreamType
    quality: string | null
    score: number
    probedAt: number
    probeSuccess: boolean
    probeLatencyMs: number | null
  }

  interface PlaybackEvent {
    type: PlaybackEventType
    gameId: string
    sourceId?: string
    details?: Record<string, unknown>
    occurredAt: number
  }

  // MUST stay in sync with PlayResult in src/main/types.ts.
  type PlayResult =
    | {
        ok: true
        candidateId: string
        streamUrl: string
        streamType: StreamType
        /** The source page URL, sent as Referer on CDN requests. */
        refererUrl: string | null
        /** Origin header the CDN expects; null when the stream is proxied. */
        cdnOrigin: string | null
        /** Referer header the CDN expects; null when the stream is proxied. */
        cdnReferer: string | null
      }
    | { ok: false; reason: 'no_candidates' | 'all_probes_failed' | 'game_not_found' | 'not_implemented' }


  /** A row from the events table, as sent by get-diagnostics. */
  interface EventRow {
    id: number
    eventType: string
    gameId: string | null
    sourceId: string | null
    /** JSON-encoded object, or null. */
    details: string | null
    occurredAt: number
  }

  interface DiagnosticsData {
    sources: Source[]
    recentProbes: unknown[]
    recentFailures: EventRow[]
    unimplementedSources: Source[]
    recentEvents: EventRow[]
  }

  interface Window {
    onair: {
      // Invoke handlers
      getGames: (league?: LeagueId) => Promise<Game[]>
      playGame: (gameId: string) => Promise<PlayResult>
      /** Request automatic failover. `reason` is recorded against the failing source. */
      switchStream: (gameId: string, reason?: string) => Promise<PlayResult>
      selectStream: (candidateId: string) => Promise<PlayResult>
      stopPlayback: () => Promise<void>
      getSources: () => Promise<Source[]>
      getCandidatesForGame: (gameId: string) => Promise<StreamCandidate[]>
      getDiagnostics: () => Promise<DiagnosticsData>
      updateSource: (sourceId: string, patch: Partial<Source>) => Promise<void>
      addSource: (source: Omit<Source, 'addedAt'>) => Promise<void>
      /** Accepts pasted text, one source per line. Reports each line's outcome. */
      addSourcesBulk: (text: string) => Promise<{
        added: string[]
        duplicates: string[]
        invalid: string[]
      }>

      /**
       * Dev fixture controls. Injects a failure into the local fixture stream
       * so the failover ladder can be observed in the real UI.
       * No-ops unless the app was started with ONAIR_FIXTURE=1.
       */
      fixtureSetMode: (
        mode: 'healthy' | 'stall' | 'segment-403' | 'manifest-404' | 'off-air' | 'slow'
      ) => Promise<{ ok: boolean; mode?: string; reason?: string }>
      fixtureStatus: () => Promise<{ enabled: boolean; mode: string | null }>
      reportEvent: (event: {
        type: string
        gameId: string
        sourceId?: string
        reason?: string
        details?: Record<string, unknown>
      }) => Promise<void>

      // Push subscriptions (return unsubscribe function)
      /** isStale is true when the last successful ESPN poll is over 5 minutes old. */
      onGamesUpdated: (cb: (update: { games: Game[]; isStale: boolean }) => void) => () => void
      onPlaybackEvent: (cb: (event: PlaybackEvent) => void) => () => void
    }
  }
}

export {}
