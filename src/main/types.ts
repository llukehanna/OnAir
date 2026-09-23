export type LeagueId = 'nba' | 'nfl' | 'cbb' | 'cfb'

export type GameStatus = 'LIVE' | 'STARTING_SOON' | 'RECENTLY_ENDED' | 'SCHEDULED'

export interface Game {
  gameId: string
  league: LeagueId
  teamHome: string
  teamAway: string
  startTime: number       // Unix ms
  status: GameStatus
}

export type SourceClassification = 'event_first' | 'channel_first' | 'mixed_aggregator'

export type HealthState = 'healthy' | 'degraded' | 'blocked' | 'broken' | 'unknown'

export type ExtractionMethod = 'network_intercept' | 'html_parse' | 'api'

export interface Source {
  sourceId: string
  name: string
  baseUrl: string
  classification: SourceClassification
  supportedLeagues: LeagueId[]
  extractionMethod: ExtractionMethod
  confidenceWeight: number
  healthState: HealthState
  healthUpdatedAt: number | null
  enabled: boolean
  needsAdapter: boolean
  addedAt: number
}

export type StreamType = 'hls' | 'dash' | 'embedded'

export interface StreamCandidate {
  candidateId: string
  gameId: string
  sourceId: string
  streamUrl: string
  streamType: StreamType
  quality: string | null    // '1080p', '720p', '480p', or null if unknown
  score: number             // 0-1
  probedAt: number          // Unix ms
  probeSuccess: boolean
  probeLatencyMs: number | null
  refererUrl: string | null // Top-level page the stream was extracted from
  cdnOrigin: string | null  // Origin header CDN expects (e.g. iframe hosting the player)
  cdnReferer: string | null // Referer header CDN expects (e.g. iframe origin + /)
  browserContext?: import('playwright').BrowserContext // Session for CDN proxy
  manifestBody?: string | null  // Cached manifest from interception
  embedPlayerUrl?: string | null // Direct embed URL for WebContentsView
}

export type PlaybackEventType =
  | 'stream_started'
  | 'stream_failed'
  | 'buffer_stall'
  | 'source_switch'
  | 'probe_result'
  | 'all_sources_failed'

export interface PlaybackEvent {
  type: PlaybackEventType
  gameId: string
  sourceId?: string
  details?: Record<string, unknown>
  occurredAt: number
}

// Event types for the events table (superset of PlaybackEventType)
export type EventType =
  | 'stream_started'
  | 'stream_failed'
  | 'source_switch'
  | 'probe_result'
  | 'all_sources_failed'
  | 'source_health_change'
  | 'api_failure'
  | 'adapter_timeout'
  | 'extraction_failure'

export interface EventRow {
  id: number
  eventType: EventType
  gameId: string | null
  sourceId: string | null
  details: string | null  // JSON string
  occurredAt: number
}

export interface ReliabilityMetrics {
  sourceId: string
  league: LeagueId
  startupSuccesses: number
  startupFailures: number
  totalStartupTimeMs: number
  bufferEvents: number
  switchEvents: number
  totalSessions: number
  consecutiveFailures: number
  lastUpdated: number
}

// IPC result types
export type PlayResult =
  | { ok: true; candidateId: string; streamUrl: string; streamType: StreamType; refererUrl: string | null; cdnOrigin: string | null; cdnReferer: string | null }
  | { ok: false; reason: 'no_candidates' | 'all_probes_failed' | 'game_not_found' | 'not_implemented' }

export interface DiagnosticsData {
  sources: (Source & { reliability: Record<LeagueId, ReliabilityMetrics> })[]
  recentProbes: EventRow[]
  recentFailures: EventRow[]
  unimplementedSources: Source[]
  recentEvents: EventRow[]
}
