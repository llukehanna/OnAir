import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// famelack.com — Famelack
//
// A curated directory of publicly available live TV channels, radio, and
// webcams (largely the IPTV-org directory). It does not address games, so
// its confidenceWeight is deliberately low and candidates only surface
// when a listing label actually names both teams. The source's main value
// is coverage breadth, not game precision.
// ---------------------------------------------------------------------------

export class FamelackAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'famelack-com',
      name: 'Famelack',
      baseUrl: 'https://famelack.com/',
      // A channel directory; never a per-game page.
      classification: 'channel_first',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'cbb', 'cfb'],
      confidenceWeight: 0.4,
      embedPlayerPatterns: [/famelack\.com\/(?:embed|player|watch|channel|video)/i],
    })
  }
}
