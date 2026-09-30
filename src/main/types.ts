export type LeagueId = 'nba' | 'nfl' | 'mlb' | 'nhl' | 'cbb' | 'cfb'

export type GameStatus = 'LIVE' | 'STARTING_SOON' | 'RECENTLY_ENDED' | 'SCHEDULED'

export interface TeamInfo {
  abbr: string
  shortName: string
  color: string | null      // '#rrggbb' or null
  altColor: string | null   // '#rrggbb' or null
  logo: string | null       // absolute https URL
  score: number | null      // null before kickoff
  record: string | null     // e.g. '3-0'
}

export interface Game {
  gameId: string
  league: LeagueId
  teamHome: string
  teamAway: string
  startTime: number       // Unix ms
  status: GameStatus
  away?: TeamInfo
  home?: TeamInfo
  statusDetail?: string   // ESPN status.type.shortDetail, e.g. 'Q3 - 4:12', 'Halftime', 'Final'
  network?: string        // TV network, national preferred, e.g. 'NBC'
  venue?: string
  headline?: string       // ESPN's round note, e.g. 'NLWC - Game 1'
}

export type ChannelCategory = 'sports' | 'news' | 'entertainment' | 'other'

export interface Channel {
  channelId: string
  name: string
  category: ChannelCategory
  sourceCount: number   // computed from channel_sources, not stored
  lastSeenAt: number
}

/** A source's link to a channel: the URL its listing page gave for it. */
export interface ChannelSourceLink {
  channelId: string
  sourceId: string
  url: string
  label: string    // the source's own listing text, for display/debugging
  seenAt: number
}

/** One entry from an adapter's listChannels() — not yet persisted. */
export interface ChannelListing {
  label: string
  url: string
}

export interface GuideProgram {
  channelId: string
  title: string
  subtitle?: string
  start: number
  end: number
  kind: 'game' | 'show'
  gameId?: string
}

export interface GuideData {
  channels: Channel[]
  programs: GuideProgram[]
  generatedAt: number
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

/** Reliability rows are scoped per-league, except channels which share one
 *  'channel' bucket across leagues (a channel has no league of its own). */
export type ReliabilityScope = LeagueId | 'channel'

export interface ReliabilityMetrics {
  sourceId: string
  league: ReliabilityScope
  startupSuccesses: number
  startupFailures: number
  totalStartupTimeMs: number
  bufferEvents: number
  switchEvents: number
  totalSessions: number
  consecutiveFailures: number
  lastUpdated: number
}

/**
 * Whatever is currently playable: a game (existing pipeline) or a 24/7
 * channel (new). Carries the resolved domain object so downstream code
 * (candidates, playback) never has to look it up again.
 */
export type WatchTarget =
  | { kind: 'game'; id: string; scope: LeagueId; game: Game }
  | { kind: 'channel'; id: string; scope: 'channel'; channel: Channel }

/** Channel ids are namespaced so isChannelId() can tell them apart from game ids. */
export const CHANNEL_ID_PREFIX = 'ch:'

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
