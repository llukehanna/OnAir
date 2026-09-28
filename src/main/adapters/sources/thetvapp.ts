import type { LeagueId } from '../../types'
import { InterceptAdapter, type InterceptAdapterConfig } from './intercept-base'

// ---------------------------------------------------------------------------
// TheTVApp platform — three live mirrors
//
// TheTVApp runs the same match-schedule UI on several domains. tvapp1.com,
// thetvapp.plus/v9, and thetvapp.st are treated as separate sources (per the
// project convention that sibling TLDs are distinct mirrors, not one id),
// but they share one adapter shape, so one factory configures all three.
//
// Each front page lists matches by sport (NBA, NFL, NCAAF/NCAAB, ...); the
// adapter searches the listing for the game's link and follows it.
// ---------------------------------------------------------------------------

/** Base config shared by every TheTVApp mirror; only the host varies. */
function makeTvAppConfig(host: string, path: string, sourceId: string, name: string): InterceptAdapterConfig {
  return {
    sourceId,
    name,
    baseUrl: `https://${host}${path}`,
    classification: 'mixed_aggregator',
    supportedLeagues: ['nba', 'nfl', 'mlb', 'cbb', 'cfb'] as LeagueId[],
    confidenceWeight: 0.6,
    embedPlayerPatterns: [new RegExp(`${host.replace(/\./g, '\\.')}/(?:embed|player|watch|channel)`, 'i')],
  }
}

export class Tvapp1Adapter extends InterceptAdapter {
  constructor() {
    super(makeTvAppConfig('tvapp1.com', '/', 'tvapp1-com', 'TheTVApp (tvapp1)'))
  }
}

export class TheTvAppPlusAdapter extends InterceptAdapter {
  constructor() {
    // /v9 is the current schedule listing on this mirror.
    super(makeTvAppConfig('thetvapp.plus', '/v9', 'thetvapp-plus', 'TheTVApp (plus)'))
  }
}

export class TheTvAppStAdapter extends InterceptAdapter {
  constructor() {
    super(makeTvAppConfig('thetvapp.st', '/', 'thetvapp-st', 'TheTVApp (st)'))
  }
}
