# IPC API

The renderer reaches the main process only through `window.onair`, exposed by `src/preload/index.ts` via `contextBridge`.
Renderer-side types live in `src/renderer/src/env.d.ts` and mirror `src/main/types.ts`.

## Games

### `getGames(league?) → Promise<Game[]>`

Games seen by discovery in the last 24 hours, optionally filtered to one league.

```ts
interface Game {
  gameId: string        // `${league}_${espnEventId}`
  league: 'nba' | 'nfl' | 'cbb' | 'cfb'
  teamHome: string
  teamAway: string
  startTime: number     // Unix ms
  status: 'LIVE' | 'STARTING_SOON' | 'SCHEDULED' | 'RECENTLY_ENDED'
}
```

Status comes from ESPN's state, refined by time: `STARTING_SOON` is a scheduled game within the hour, and `RECENTLY_ENDED` is a final within the last three hours.

### `onGamesUpdated(cb) → unsubscribe`

Pushed after every discovery poll.

```ts
cb({ games: Game[], isStale: boolean })   // isStale: last successful poll > 5 min ago
```

## Playback

All four calls resolve to a `PlayResult`:

```ts
type PlayResult =
  | {
      ok: true
      candidateId: string
      streamUrl: string          // hand this to hls.js
      streamType: 'hls' | 'dash' | 'embedded'
      refererUrl: string | null
      cdnOrigin: string | null   // informational; main injects CDN headers itself
      cdnReferer: string | null
    }
  | { ok: false; reason: 'no_candidates' | 'all_probes_failed' | 'game_not_found' | 'not_implemented' }
```

| Call | Behaviour |
|---|---|
| `playGame(gameId)` | Stops whatever is playing, then resolves the best stream: cache, then validation, then extraction |
| `switchStream(gameId, reason?)` | Automatic failover. Leaves the current stream running and climbs the ladder in [FAILOVER.md](FAILOVER.md). `reason` is recorded against the failing source. Concurrent calls collapse into one switch |
| `selectStream(candidateId)` | The user picked a specific candidate. It's pinned as a preference, but failover still moves off it if it dies |
| `stopPlayback()` | Stops playback, the off-air watch, the proxy, and any embedded view |

`streamType: 'embedded'` means the main process is showing the source's own player in a `WebContentsView`. The renderer only needs to reflect the playing state.

`not_implemented` is also returned when a switch is already in flight; the in-flight one wins.

### `getCandidatesForGame(gameId) → Promise<StreamCandidate[]>`

The cached, ranked candidates for a game (what the source picker lists). Includes `candidateId`, `sourceId`, `quality`, `score` (0–1), and `streamType`.

### `onPlaybackEvent(cb) → unsubscribe`

```ts
interface PlaybackEvent {
  type: 'stream_started' | 'stream_failed' | 'buffer_stall' | 'source_switch' | 'probe_result' | 'all_sources_failed'
  gameId: string
  sourceId?: string
  details?: Record<string, unknown>   // source_switch carries { reason, sourceName }
  occurredAt: number
}
```

The failover toast listens for `source_switch`.

### `reportEvent({ type, gameId, sourceId?, reason?, details? })`

The renderer's channel for failures only it can see, such as a fatal hls.js error or a stream that never produced a frame. Written to the `events` table.

## Sources

| Call | Behaviour |
|---|---|
| `getSources()` | Every row in `sources` |
| `addSource(source)` | Insert or replace one source |
| `updateSource(sourceId, patch)` | Partial update |
| `addSourcesBulk(text)` | One URL per line → `{ added, duplicates, invalid }`, deduplicated by hostname. New sources land with no supported leagues and `needsAdapter: true`, so they can't consume pool slots until an adapter exists |

A source row and a registered adapter are both required before a source produces candidates. See [ADAPTERS.md](ADAPTERS.md).

## Diagnostics

### `getDiagnostics() → Promise<DiagnosticsData>`

```ts
interface DiagnosticsData {
  sources: Source[]
  recentEvents: EventRow[]        // last 50, newest first; details is a JSON string
  recentFailures: EventRow[]      // recentEvents whose type contains 'fail'
  recentProbes: unknown[]         // reserved; currently empty
  unimplementedSources: Source[]  // reserved; currently empty
}
```

## Development fixture

Active only when the app starts with `ONAIR_FIXTURE=1`. Otherwise `fixtureSetMode` returns `{ ok: false, reason: 'fixture_disabled' }` and `fixtureStatus` reports `enabled: false`.

| Call | Behaviour |
|---|---|
| `fixtureSetMode(mode)` | Puts the primary fixture stream into `healthy`, `stall`, `segment-403`, `manifest-404`, `off-air`, or `slow`. The secondary stays healthy so failover has somewhere to land |
| `fixtureStatus()` | `{ enabled, mode }` |
