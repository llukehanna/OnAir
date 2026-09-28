import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// zlive.st — ZLive
//
// Minimal free live sports & TV streaming front page. The whole site is a
// single listing, so the adapter searches the home page's links for the
// game and follows whichever watch page names both teams.
// ---------------------------------------------------------------------------

export class ZliveStAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'zlive-st',
      name: 'ZLive',
      baseUrl: 'https://zlive.st/',
      // One page mixes matches with general TV channels.
      classification: 'mixed_aggregator',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'cbb', 'cfb'],
      confidenceWeight: 0.6,
      embedPlayerPatterns: [/zlive\.st\/(?:embed|player|watch)/i],
    })
  }
}
