import { InterceptAdapter } from './intercept-base'

// ---------------------------------------------------------------------------
// streamsports99.ru — StreamSports99
//
// Free live sports site whose /live-tv page lists channels and live
// events. The adapter searches that listing for a link naming the game;
// if none does, it honestly reports no candidates rather than handing
// back an unrelated channel stream.
//
// /live-tv doubles as the 24/7 channel directory: cards are grouped by
// country, each linking to /live-tv/<Name>__<countrycode> (e.g.
// /live-tv/ACC%20Network__us, /live-tv/ESPN__uk). linkPatterns is
// restricted to the "__us" suffix specifically (not any two-letter country
// code) — the guide is a US TV guide, and a non-US duplicate of a channel
// already carried by the US group (a UK ESPN feed, say) would otherwise
// register as a second, redundant link to the same canonical channel.
// ---------------------------------------------------------------------------

export class Streamsports99Adapter extends InterceptAdapter {
  constructor() {
    super({
      sourceId: 'streamsports99-ru',
      name: 'StreamSports99',
      baseUrl: 'https://streamsports99.ru/live-tv',
      // Channel-first listing; events are matched by their link label.
      classification: 'channel_first',
      supportedLeagues: ['nba', 'nfl', 'mlb', 'cbb', 'cfb'],
      confidenceWeight: 0.55,
      embedPlayerPatterns: [/streamsports99\.ru\/(?:embed|player|watch|channel)/i],
      channels: {
        listUrl: 'https://streamsports99.ru/live-tv',
        linkPatterns: [/^\/live-tv\/.+__us$/i],
      },
    })
  }
}
