import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// ntv.st — NTVSTREAM
//
// Sports streaming site organized around "server" pages (Kobra, Falcon,
// Raptor, Phoenix, Titan), each listing live matches plus 24/7 channels.
// The Kobra matches page is the listing the adapter searches for the game;
// match links and the embedded player live under the same host.
// ---------------------------------------------------------------------------

export class NtvStAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'ntv-st',
      name: 'NTVSTREAM',
      baseUrl: 'https://ntv.st/matches/kobra',
      // Matches pages list events per game, alongside 24/7 channels.
      classification: 'mixed_aggregator',
      supportedLeagues: ['nba', 'nfl', 'cbb', 'cfb'],
      confidenceWeight: 0.6,
      embedPlayerPatterns: [/ntv\.st\/(?:embed|player|watch)/i],
    })
  }
}
