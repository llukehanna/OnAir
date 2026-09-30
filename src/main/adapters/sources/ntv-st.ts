import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// ntv.st — NTVSTREAM
//
// Sports streaming site organized around "server" pages (Kobra, Falcon,
// Raptor, Phoenix, Titan), each listing live matches plus 24/7 channels.
// The Kobra matches page is the listing the adapter searches for the game;
// match links and the embedded player live under the same host.
//
// /channels is a separate, dedicated 24/7 channel directory: each card links
// to /channel/<server>/<name> (e.g. /channel/titan/ACC-Network?code=us).
// linkPatterns requires the singular "/channel/" segment so it doesn't also
// match the nav's own "/channels" link (plural, no per-channel path).
// ---------------------------------------------------------------------------

export class NtvStAdapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'ntv-st',
      name: 'NTVSTREAM',
      baseUrl: 'https://ntv.st/matches/kobra',
      // Matches pages list events per game, alongside 24/7 channels.
      classification: 'mixed_aggregator',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'nhl', 'cbb', 'cfb'],
      confidenceWeight: 0.6,
      embedPlayerPatterns: [/ntv\.st\/(?:embed|player|watch)/i],
      channels: {
        listUrl: 'https://ntv.st/channels',
        linkPatterns: [/^\/channel\/[a-z]+\//i],
      },
    })
  }
}
