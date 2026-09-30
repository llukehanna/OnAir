import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// zlive.st — ZLive
//
// Minimal free live sports & TV streaming front page. The whole site is a
// single listing, so the adapter searches the home page's links for the
// game and follows whichever watch page names both teams.
//
// The same home page is also the 24/7 channel directory: every card links
// to /watch/<slug>. linkPatterns anchors the pattern to the start of the
// path so it doesn't also catch "/streams" (the nav link) or other
// s-t-r-e-a-m-shaped paths that aren't a channel's own watch page.
// ---------------------------------------------------------------------------

export class ZliveStAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'zlive-st',
      name: 'ZLive',
      baseUrl: 'https://zlive.st/',
      // One page mixes matches with general TV channels.
      classification: 'mixed_aggregator',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb'],
      confidenceWeight: 0.6,
      embedPlayerPatterns: [/zlive\.st\/(?:embed|player|watch)/i],
      channels: {
        listUrl: 'https://zlive.st/',
        linkPatterns: [/^\/watch\//i],
      },
    })
  }
}
