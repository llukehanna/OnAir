import type { SourceAdapter, RawStreamCandidate } from '../base'
import type { Game, HealthState, LeagueId } from '../../types'
import type { PlaywrightPool } from '../pool'

export class StubAdapter implements SourceAdapter {
  readonly sourceId = 'stub'
  readonly name = 'Stub Adapter'
  readonly baseUrl = 'https://example.invalid'
  readonly classification = 'event_first' as const
  readonly supportedLeagues: LeagueId[] = ['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb']
  readonly extractionMethod = 'html_parse' as const
  readonly confidenceWeight = 0

  async getCandidateStreams(_game: Game, _pool: PlaywrightPool): Promise<RawStreamCandidate[]> {
    return []
  }

  async getSourceHealth(_pool: PlaywrightPool): Promise<HealthState> {
    return 'unknown'
  }
}
