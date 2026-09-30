import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// famelack.com — Famelack
//
// A curated directory of publicly available live TV channels, radio, and
// webcams (largely the IPTV-org directory). It does not address games, so
// its confidenceWeight is deliberately low and candidates only surface
// when a listing label actually names both teams. The source's main value
// is coverage breadth, not game precision.
//
// No `channels` config: despite the name, famelack.com/tv has no flat page
// of channel links to scan. It's a country picker (a <span> grid, not
// anchors — the actual channel list only renders after a country is
// clicked), which would mean multi-step interaction rather than a single
// read-only page load. Confirmed with a rendered-Chrome fetch of / and /tv
// (see task-2-report.md); left unset rather than guessed at.
// ---------------------------------------------------------------------------

export class FamelackAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'famelack-com',
      name: 'Famelack',
      baseUrl: 'https://famelack.com/',
      // A channel directory; never a per-game page.
      classification: 'channel_first',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb'],
      confidenceWeight: 0.4,
      embedPlayerPatterns: [/famelack\.com\/(?:embed|player|watch|channel|video)/i],
    })
  }
}
