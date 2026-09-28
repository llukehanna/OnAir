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
// /live-tv/ACC%20Network__us). linkPatterns requires that "__<cc>" suffix
// so nav links that merely contain "live-tv" (the listing page itself,
// "Live Scoreboard", ...) aren't mistaken for channel links.
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
        linkPatterns: [/^\/live-tv\/.+__[a-z]{2}$/i],
      },
    })
  }
}
