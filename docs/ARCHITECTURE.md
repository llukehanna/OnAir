# Architecture

OnAir is an Electron app with two processes that talk only over IPC.
The main process owns the network, the headless browser pool, the stream engine, and SQLite.
The renderer owns the UI and the two `<video>` elements, and nothing else.

```
Main process (Node)                         Renderer (Chromium)
├── Game discovery      ESPN scoreboard     ├── React UI
├── PlaywrightPool      ≤ 4 pages           ├── usePlayback: two <video> slots
├── Source adapters     plug-in interface   │     active + staging, hls.js
├── Stream engine       match/probe/score   ├── Stall state machine
├── URL cache + warmer                      ├── Fatal-error classifier
├── Playback manager    failover ladder     └── Continuity (PDT alignment)
├── CORS + CDN headers, stream proxy
└── SQLite              better-sqlite3
            ▲                                          ▲
            └──────── contextBridge (window.onair) ────┘
```

The renderer has no Node access, no filesystem, and no direct network calls outside hls.js fetching the stream it was handed.
Every capability goes through [`window.onair`](IPC_API.md).

## Source layout

| Path | Responsibility |
|---|---|
| `src/main/discovery/` | ESPN polling, status normalization, off-season detection |
| `src/main/adapters/` | `SourceAdapter` interface, registry, Playwright pool, network interception |
| `src/main/engine/` | Candidate collection, team matching, manifest probing, scoring, URL cache, pre-warmer |
| `src/main/playback/` | Playback manager, failover session, off-air detection, CORS, stream proxy, ad blocking, embedded-player tier |
| `src/main/db/` | Connection, migrations, queries, maintenance |
| `src/main/dev/` | Fixture source: local HLS origin with injectable failures |
| `src/preload/` | The `window.onair` bridge |
| `src/renderer/src/hooks/usePlayback.ts` | Dual-video staging, swap on first frame, failover requests |
| `src/renderer/src/playback/` | Pure, Node-testable logic: stall machine, error classifier, continuity |

## Click to playback

```
click game
  → PlaybackManager.play(gameId)          destroys whatever is playing: a new game always wins
  → URL cache
      fresh  (< 3 min)   use as-is
      stale  (3–8 min)   HEAD-validate the top 3, keep what answers
      expired / empty    full extraction ↓
  → collectAndRankCandidates(game)
      1. adapters that support the league and whose source isn't broken/blocked
      2. getCandidateStreams() on all of them concurrently
      3. match each stream to the game, compose confidence, drop < 0.5
      4. probe every master playlist in parallel (resolution → quality score)
      5. score and sort
  → PlayResult { candidateId, streamUrl, cdnOrigin, cdnReferer, … }
  → renderer loads it on the staging <video>, swaps on the first fragment
```

Step 2 returns early. As soon as one adapter yields a viable candidate, the engine gives the others a two-second grace period rather than waiting on the slowest source.

### Confidence and scoring

Two separate questions decide whether a candidate is worth trying:

- **Is this a real stream?** The adapter answers with `extractionConfidence`.
- **Is it the right game?** The matcher answers.
  `event_first` sources address games directly and get 1.0.
  For other sources, the stream's text is matched against a team alias dictionary: 0.9 for both teams, 0.5 for one, 0.3 for an ambiguous college nickname alone ("Tigers").

Their product must clear 0.5. Survivors are ranked by

```
score = ( 0.50 × reliability history
        + 0.20 × stability
        + 0.15 × video quality
        + 0.10 × startup speed
        + 0.05 × confidence ) × health multiplier
```

Reliability history comes from `source_reliability`, which playback writes after every start, stall, and switch.
A source with no history scores a neutral 0.5 on those terms, so ranking improves with use instead of staying at its seeded defaults.

## Background activity

| Task | Interval | Notes |
|---|---|---|
| ESPN poll | 60s with a live game, 2 min with one starting within the hour, else 10 min | All four leagues in parallel; one failing league doesn't block the rest |
| Pre-warmer | every 2.5 min | Re-extracts candidates for live games and games starting within 10 minutes, so most clicks hit a warm cache. First cycle is delayed 90s so startup isn't starved |
| Off-air watch | while playing | Polls the playing stream's media sequence; see [FAILOVER.md](FAILOVER.md) |
| Maintenance | on startup | Games kept 7 days, events 30 days (hard ceiling 50,000 rows), then `VACUUM` if worthwhile |

## The Playwright pool

Adapters that need a real browser share one `PlaywrightPool`: at most **4** concurrent pages from a single headless Chromium.
No adapter launches its own browser, which is what keeps a dozen sources from becoming a dozen Chromium processes.

- **Priority.** `acquire('user')` jumps ahead of every queued `'background'` request, so a click is never stuck behind the pre-warmer.
- **Reuse.** Released pages are wiped (cookies, storage, `about:blank`) and handed to the next waiter or parked idle for 60s.
- **Lazy launch.** Chromium starts on the first request, so a session that only uses the fixture source never starts a browser.

`interceptStreams()` in `adapters/intercept.ts` is the shared extraction helper.
It routes every request a page makes, captures the first manifest that looks like a game stream along with the `Origin`/`Referer` the player used, and aborts ad-network requests.

## Getting streams into the renderer

Third-party CDNs rarely serve CORS headers for an Electron origin, and many check `Origin`/`Referer` or bind tokens to the browser session that fetched the page.

- **CORS injection.** `session.webRequest.onHeadersReceived` sets `Access-Control-Allow-Origin: *` on responses to the renderer (and strips `Allow-Credentials`, which browsers reject alongside `*`), so hls.js can read manifests and segments.
- **CDN headers.** Before hls.js starts, the playback manager registers the `Origin`/`Referer` the CDN expects. `onBeforeSendHeaders` rewrites them onto stream requests, so the renderer never has to know them.
- **Session-bound proxy.** When a CDN ties tokens to the capturing session, a local HTTP proxy serves the stream by fetching through the Playwright browser context that captured it: same cookies, same TLS client.
- **Ad blocking.** EasyList rules, cached on disk, block ad requests in the renderer's session. Adapters get the same rules through `getAdRules()` and pass them to `interceptStreams()` for their headless pages.

## Key decisions

**Two video elements, not one.** Switching a single element means tearing down before the replacement exists, which means black frames.
With an active and a staging element, the replacement loads out of sight and becomes visible on its first frame.

**Failover is not play.** `play()` destroys immediately because the user asked for different content.
`failover()` never does, because the current picture, however degraded, beats nothing.
See [FAILOVER.md](FAILOVER.md).

**Pure logic outside React.** The stall machine, error classifier, and continuity math are plain TypeScript modules with no hls.js import, so they're unit-tested under Node with plain objects.

**Tests run inside Electron's Node.** `better-sqlite3` is compiled for Electron's ABI.
Running Jest under the system Node would require rebuilding it for Node, which fixes the tests by breaking the app.
`npm test` sets `ELECTRON_RUN_AS_NODE=1` and runs Jest with Electron's binary.

**New sources land inert.** A source added by URL gets `needsAdapter: true` and no supported leagues, so a site with no adapter can't consume pool slots.
