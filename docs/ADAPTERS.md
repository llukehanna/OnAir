# Writing a source adapter

A source adapter answers one question: *for this game, where are the streams?*
Everything after that is source-agnostic: matching, probing, ranking, playback, failover, continuity, and reliability tracking.

OnAir ships no third-party adapters.
The fixture source in `src/main/dev/fixture-adapter.ts` is the reference implementation.

## The interface

```ts
// src/main/adapters/base.ts
interface SourceAdapter {
  readonly sourceId: string            // stable id; must match a row in the sources table
  readonly name: string                // shown in the UI
  readonly baseUrl: string
  readonly classification: 'event_first' | 'channel_first' | 'mixed_aggregator'
  readonly supportedLeagues: LeagueId[]
  readonly extractionMethod: 'network_intercept' | 'html_parse' | 'api'
  readonly confidenceWeight: number    // 0–1

  getCandidateStreams(game: Game, pool: PlaywrightPool): Promise<RawStreamCandidate[]>
  getSourceHealth(pool: PlaywrightPool): Promise<HealthState>
}
```

`getCandidateStreams` returns zero or more `RawStreamCandidate`s:

| Field | Required | Meaning |
|---|---|---|
| `streamUrl` | yes | The master playlist URL |
| `streamType` | yes | `'hls'`, `'dash'`, or `'embedded'` |
| `quality` | yes | e.g. `'1080p'`, or `null` to let the prober read it from the playlist |
| `extractionConfidence` | yes | 0–1: how sure the adapter is this is a real stream |
| `refererUrl` | no | Referer used while probing; defaults to `baseUrl` |
| `cdnOrigin`, `cdnReferer` | no | Headers the CDN checks; injected on every stream request |
| `browserContext` | no | The Playwright context that captured the stream, for CDNs that bind tokens to a session |
| `manifestBody` | no | The playlist as captured, for single-use tokens |
| `preProbed` | no | Probe result from inside the browser, when a plain fetch would be rejected |
| `embedPlayerUrl` | no | A page whose player can be shown in the embedded fallback tier |

Return `[]` rather than throwing when there's nothing to offer. A throw is caught and logged, but `[]` is the honest answer.

### Classification

`classification` tells the engine how much to trust that a stream belongs to the game it was asked about:

- **`event_first`**: the source addresses games directly (a URL or API call per game). Match confidence is 1.0.
- **`channel_first`** and **`mixed_aggregator`**: the source lists channels or mixed events. Each stream's text is matched against the team alias dictionary in `engine/matcher.ts`, and anything under 0.5 is dropped.

The final confidence is `extractionConfidence × matchConfidence`, so both have to be high for a candidate to rank well.

## Three shapes of adapter

**From an API.** When the source has an API, no browser is needed:

```ts
export class ExampleApiAdapter implements SourceAdapter {
  readonly sourceId = 'example-api'
  readonly name = 'Example API'
  readonly baseUrl = 'https://api.example.com'
  readonly classification = 'event_first' as const
  readonly supportedLeagues: LeagueId[] = ['nba']
  readonly extractionMethod = 'api' as const
  readonly confidenceWeight = 0.9

  async getCandidateStreams(game: Game): Promise<RawStreamCandidate[]> {
    const res = await fetch(`${this.baseUrl}/events/${game.gameId}/streams`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const { streams } = (await res.json()) as { streams: { url: string; height: number }[] }
    return streams.map((s) => ({
      streamUrl: s.url,
      streamType: 'hls' as const,
      quality: `${s.height}p`,
      extractionConfidence: 0.95,
    }))
  }

  async getSourceHealth(): Promise<HealthState> {
    const res = await fetch(`${this.baseUrl}/health`).catch(() => null)
    return res?.ok ? 'healthy' : 'degraded'
  }
}
```

**From a page with a player.** When the stream URL only exists once a page's player runs, borrow a page from the shared pool and let `interceptStreams()` capture the manifest request:

```ts
async getCandidateStreams(game: Game, pool: PlaywrightPool): Promise<RawStreamCandidate[]> {
  const page = await pool.acquire('user')
  try {
    const captured = await interceptStreams(page, this.pageFor(game), getAdRules() ?? noOpAdRules)
    if (!captured) return []
    return [{
      streamUrl: captured.streamUrl,
      streamType: 'hls',
      quality: captured.preProbed.quality,
      extractionConfidence: 0.8,
      cdnOrigin: captured.cdnOrigin,
      cdnReferer: captured.cdnReferer,
      preProbed: captured.preProbed,
      manifestBody: captured.manifestBody,
      browserContext: captured.browserContext,
    }]
  } finally {
    pool.release(page)   // always, or the slot leaks
  }
}
```

Never launch a browser yourself; always go through the pool.
It caps the whole app at four pages and lets clicks preempt background refreshes.
Release in `finally`, even on error.

**Local or synthetic.** See `FixtureAdapter`: it returns URLs for streams served in-process.

## Registering

1. Register the adapter in `src/main/index.ts`, after the pool is created:
   ```ts
   register(new ExampleApiAdapter())
   ```
2. Make sure a matching row exists in `sources`.
   The engine checks each adapter against the table and skips any whose row is missing or whose health is `broken` or `blocked`.
   `upsertFixtureSource()` in `fixture-adapter.ts` shows the pattern.

## Testing an adapter

Adapters take their dependencies as arguments, so they test without a network or a browser:

- pass a mock `PlaywrightPool` (see `tests/helpers/playwright-mock.ts`)
- stub `fetch`
- run the output through `collectAndRankCandidates(game, pool, db, fetchFn, () => [adapter])` with an in-memory database from `tests/helpers/db.ts` to see how it ranks
