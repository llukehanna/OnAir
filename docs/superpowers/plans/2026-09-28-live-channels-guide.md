# Live Channels and Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune to 24/7 channels that the built-in sources carry, through the existing failover pipeline, and browse them in a TV guide with what's on.

**Architecture:** A `WatchTarget` (a game or a channel) replaces `Game` at the playback manager and candidate collection seams. Channels are discovered from the sources' channel pages by a background scheduler and canonicalized into `channels` and `channel_sources` tables. Listings merge ESPN games with the TVmaze schedule. The renderer adds a Guide screen and lets the player show a channel.

**Tech Stack:** Electron 34, TypeScript, better-sqlite3, Playwright (pooled), React 18 with CSS Modules, Jest under Electron's Node.

**Spec:** `docs/superpowers/specs/2026-09-28-live-channels-guide-design.md`

## Global Constraints

- Channel ids are `ch:` followed by a lowercase slug of `[a-z0-9]`, for example `ch:espn2`. Game ids are unchanged.
- Everything past candidate collection stays unchanged: probing, scoring, proxy, failover session, continuity, off-air, and the renderer's `usePlayback`.
- Discovery uses `pool.acquire('background')` and always releases the page.
- New code follows the file's existing style: comment density, error handling (return `[]` rather than throw from adapters), and injected functions for testability in `PlaybackManager`.
- Verification: `npm test`, `npm run typecheck`, `npm run lint`.

---

### Task 1: Watch targets, migration 3, channel storage

**Files:**
- Modify: `src/main/types.ts`, `src/renderer/src/env.d.ts`, `src/main/db/migrations.ts`, `src/main/db/queries/reliability.ts`, `src/main/engine/candidates.ts`, `src/main/engine/index.ts`, `src/main/playback/manager.ts`, `src/main/adapters/base.ts`, `src/main/dev/fixture-adapter.ts`
- Create: `src/main/db/queries/channels.ts`, `src/main/engine/targets.ts`
- Test: `tests/db/migrations.test.ts`, `tests/db/queries/channels.test.ts`, `tests/engine/targets.test.ts`, `tests/engine/candidates.test.ts`, `tests/playback/manager.test.ts`

**Interfaces (produced):**

```ts
// types.ts (mirrored in env.d.ts, except WatchTarget)
export type ChannelCategory = 'sports' | 'news' | 'entertainment' | 'other'
export interface Channel { channelId: string; name: string; category: ChannelCategory; sourceCount: number; lastSeenAt: number }
export interface ChannelSourceLink { channelId: string; sourceId: string; url: string; label: string; seenAt: number }
export interface ChannelListing { label: string; url: string }
export interface GuideProgram { channelId: string; title: string; subtitle?: string; start: number; end: number; kind: 'game' | 'show'; gameId?: string }
export interface GuideData { channels: Channel[]; programs: GuideProgram[]; generatedAt: number }
export type ReliabilityScope = LeagueId | 'channel'
export type WatchTarget =
  | { kind: 'game'; id: string; scope: LeagueId; game: Game }
  | { kind: 'channel'; id: string; scope: 'channel'; channel: Channel }
export const CHANNEL_ID_PREFIX = 'ch:'

// adapters/base.ts — optional additions to SourceAdapter
listChannels?(pool: PlaywrightPool): Promise<ChannelListing[]>
getChannelStreams?(url: string, pool: PlaywrightPool): Promise<RawStreamCandidate[]>

// db/queries/channels.ts
export function upsertChannelLinks(sourceId: string, links: Array<{ channelId: string; name: string; category: ChannelCategory; url: string; label: string }>, now?: number, db?): void
export function pruneChannelLinks(olderThanMs: number, now?: number, db?): void   // deletes stale links, then channels with no links
export function getChannels(db?): Channel[]                                       // sourceCount computed, sorted by name
export function getChannelById(channelId: string, db?): Channel | null
export function getChannelLinks(channelId: string, db?): ChannelSourceLink[]

// engine/targets.ts
export function isChannelId(id: string): boolean
export function resolveTarget(id: string, deps?: { getGame?: (id: string) => Game | null; getChannel?: (id: string) => Channel | null }): WatchTarget | null
```

- `getReliability`, `recordStartupSuccess`, `recordStartupFailure` and `recordSwitchEvent` accept `ReliabilityScope` in place of `LeagueId`. The column is already TEXT.
- `collectAndRankCandidates(target: WatchTarget, pool?, db?, fetchFn?, adaptersFn?, linksFn?)`, and `getStreamCandidates(target, …)`:
  - **For a game:** existing behavior, using `target.game`.
  - **For a channel:** eligible adapters are those that implement `getChannelStreams`, are in a healthy DB state, and have a `getChannelLinks(target.id)` entry. Call `getChannelStreams(link.url, pool)`. `matcherConfidence = 1.0`. Candidate `gameId` is `target.id`. Reliability scope is `'channel'`.
- `PlaybackManager` resolves targets:
  - Replace `GetGameFn` with `GetTargetFn = (id) => WatchTarget | null`, defaulting to `resolveTarget`.
  - `play(id)` returns `{ ok:false, reason:'game_not_found' }` when unresolved (the reason is unchanged, for the renderer's copy).
  - `currentGame` becomes `currentTarget`. Use `target.id` wherever `game.gameId` was used, and `target.scope` wherever `game.league` was used.
  - `GetStreamCandidatesFn = (target: WatchTarget) => Promise<StreamCandidate[]>`.
- Migration 3 `channels_and_candidate_targets` does three things:
  - Creates the `channels` and `channel_sources` tables:
    - `channels (channel_id TEXT PK, name TEXT NOT NULL, category TEXT NOT NULL, last_seen_at INTEGER NOT NULL)`
    - `channel_sources (channel_id TEXT NOT NULL, source_id TEXT NOT NULL, url TEXT NOT NULL, label TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY(channel_id, source_id), FOREIGN KEY(channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE, FOREIGN KEY(source_id) REFERENCES sources(source_id))`
  - Rebuilds `stream_candidates` without the `games` foreign key (create new, copy rows, drop old, rename) and recreates its two indexes.
- Fixture adapter:
  - `listChannels` returns `[{ label: 'OnAir Test Channel HD', url: <fixture origin>/channel/a }, { label: 'OnAir Test Channel 2', url: <fixture origin>/channel/b }]`.
  - `getChannelStreams(url)` returns stream A for `/channel/a` and B for `/channel/b`, with the same candidate shape as its game streams.

- [ ] **Step 1: Failing tests.**
  - migrations:
    - `schema_version` is `[1,2,3]`
    - `channels` and `channel_sources` exist
    - inserting a `stream_candidates` row with `game_id='ch:x'` succeeds with foreign keys on
    - existing candidate rows survive the upgrade
  - channels queries:
    - upsert then `getChannels` returns one channel with `sourceCount` 2 when two sources link it
    - `pruneChannelLinks` removes links older than the cutoff and orphaned channels
  - targets:
    - `resolveTarget('ch:espn')` returns the channel target (via the injected getChannel)
    - a game id returns the game target
    - an unknown id returns null
  - candidates:
    - a channel target calls only adapters that have a link and implement `getChannelStreams`
    - the candidate's `gameId` is the channel id
  - manager:
    - `play('ch:test')` with an injected target and a candidates fn starts playback, and `session`'s gameId is `ch:test`
- [ ] **Step 2:** Run them; see them fail.
- [ ] **Step 3:** Implement to the interfaces above.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run lint` all pass.
- [ ] **Step 5:** Commit `feat(playback): watch targets so channels ride the failover pipeline`.

---

### Task 2: Channel discovery

**Files:**
- Create: `src/main/channels/canonical.ts`, `src/main/channels/scheduler.ts`, `tests/channels/canonical.test.ts`, `tests/channels/scheduler.test.ts`, `tests/fixtures/channel-pages/*.html` (saved listing HTML, trimmed)
- Modify: `src/main/adapters/sources/intercept-base.ts`, the four channel-listing source files, `src/main/index.ts` (start/stop the scheduler), `src/main/ipc/handlers.ts` (`get-channels`, `refresh-channels`)

**Interfaces (produced):**

```ts
// channels/canonical.ts
export function canonicalChannel(label: string): { channelId: string; name: string; category: ChannelCategory } | null

// intercept-base.ts config
readonly channels?: { listUrl: string; linkPatterns?: readonly RegExp[] }
// InterceptAdapter implements listChannels / getChannelStreams only when config.channels is set:
// listChannels: load listUrl, collect anchors (same anchor extraction as findGameLink) whose pathname matches linkPatterns (default [/\/(channel|live|tv|watch|stream)/i]) and whose canonicalChannel(label) is non-null
// getChannelStreams: acquire 'user', interceptStreams(page, url, …) exactly like step 3 of getCandidateStreams, matchText = label-less (null)

// channels/scheduler.ts
export function startChannelDiscovery(pool: PlaywrightPool, adapters: () => SourceAdapter[], onUpdate: (channels: Channel[]) => void): void  // run now, then every 30 min
export function stopChannelDiscovery(): void
export async function discoverOnce(pool, adapters, db?): Promise<Channel[]>   // for tests and 'refresh-channels'
```

- **canonicalChannel rules:**
  - Lowercase, then turn `&` into ` and `, drop punctuation, and split into tokens.
  - Drop the tokens `hd fhd uhd 4k sd usa us east west pacific live stream channel 24 7 247 hq tv-hd`. Keep `tv` when it's part of the name, as in "NBA TV".
  - Return `null` when the tokens include `vs`, `v`, `at`, or match navigation words (`home schedule login signup menu more all channels`), or when the result is empty or longer than 5 words.
  - Apply the variant map on the joined tokens:
    - `fox sports 1 | fs 1 → FS1`, `fox sports 2 | fs 2 → FS2`
    - `espn 2 → ESPN2`, `espn u → ESPNU`, `espn news → ESPNews`
    - `nbc sports network → NBCSN`, `cbs sports network | cbssn → CBS Sports Network`
    - `nfl redzone | red zone → NFL RedZone`, `big ten network | btn → Big Ten Network`
    - `sec network → SEC Network`, `acc network → ACC Network`
  - The slug is the display name lowercased with non-alphanumerics removed.
  - The display name comes from the variant map, otherwise the tokens title-cased, with tokens of 4 or fewer letters that were uppercase in the source label kept uppercase.
  - **Categories:** a sports set (`espn espn2 espnu espnews fs1 fs2 nfl-network nflredzone mlbnetwork nbatv nhlnetwork cbssportsnetwork bigtennetwork secnetwork accnetwork golfchannel tennischannel beinsports nbcsn tnt tbs trutv usanetwork`), a news set (`cnn foxnews msnbc cnbc bbcnews abcnewslive cbsnews newsmax skynews`), and an entertainment set (`abc cbs nbc fox amc hgtv tlc bravo e fx fxx paramountnetwork comedycentral disneychannel nickelodeon cartoonnetwork history discovery foodnetwork`). Everything else is `other`.
- **Source configs:** open each of the four sources' channel pages with Playwright (or `curl`), save a trimmed HTML sample to `tests/fixtures/channel-pages/<sourceId>.html`, and set `channels.listUrl` and `linkPatterns` to match what is actually there. If a source has no usable channel page, leave `channels` unset and note it in the commit message; don't guess.
- **Scheduler:**
  - Call `listChannels` sequentially per adapter.
  - Canonicalize each listing and pass the non-null ones to `upsertChannelLinks(sourceId, …)`.
  - Afterwards run `pruneChannelLinks(24h)`, then `onUpdate(getChannels())`.
  - A single adapter throwing must not stop the others.

- [ ] **Step 1: Failing tests.**
  - canonical:
    - `'ESPN 2 HD' → ESPN2 (sports)`
    - `'Fox Sports 1 USA' → FS1`
    - `'NBA TV' → NBA TV, ch:nbatv`
    - `'CNN Live' → CNN (news)`
    - `'Lakers vs Celtics' → null`
    - `'Home' → null`
    - `'HGTV East' → HGTV (entertainment)`
    - `'Some Local 12' → other`
  - parser: for each saved HTML sample, `listChannels` over a page loaded with `page.setContent(html)` finds at least N known channels.
  - scheduler: with fake adapters, it upserts and prunes, and one adapter throwing doesn't stop the others.
- [ ] **Step 2:** Run them; see them fail.
- [ ] **Step 3:** Implement. Register the scheduler in `index.ts` after sources are registered, and push `channels-updated` to the window.
- [ ] **Step 4:** Full verification.
- [ ] **Step 5:** Commit `feat(channels): discover the channels sources carry`.

---

### Task 3: Listings (games + TVmaze)

**Files:**
- Create: `src/main/channels/listings.ts`, `tests/channels/listings.test.ts`
- Modify: `src/main/ipc/handlers.ts` (`get-guide`), `src/preload/index.ts` (`getGuide`, `onGuideUpdated`, `onChannelsUpdated`, `refreshChannels`), `src/main/index.ts` (refresh every 30 min, and after games and channels updates; push `guide-updated`)

**Interfaces (produced):**

```ts
export const GAME_MINUTES: Record<LeagueId, number>  // nfl 195, cfb 210, mlb 180, nba 150, cbb 120
export function gamePrograms(games: Game[]): GuideProgram[]      // only games whose network canonicalizes; title 'Away at Home' (short names), subtitle headline ?? statusDetail
export function tvmazePrograms(episodes: TvmazeEpisode[]): GuideProgram[]
export function mergePrograms(games: GuideProgram[], shows: GuideProgram[]): GuideProgram[]  // drops shows overlapping a game on the same channel; sorted by channel then start
export async function fetchTvmaze(dates: string[], fetchFn?: typeof fetch): Promise<TvmazeEpisode[]>  // 5s timeout per request; failures yield []
export async function buildGuide(deps: { channels: Channel[]; games: Game[]; fetchFn?: typeof fetch; now?: number }): Promise<GuideData>  // keeps programs within [now-1h, now+24h] for known channels only
```

`TvmazeEpisode` is the subset used: `{ airstamp: string; runtime: number | null; name: string; show: { name: string; network?: { name: string } | null; webChannel?: { name: string } | null } }`. Show title = `show.name`, subtitle = episode `name` when it differs.

- [ ] **Step 1: Failing tests.**
  - A game on NBC becomes an `ch:nbc` program of 180 minutes for MLB.
  - A show overlapping it on `ch:nbc` is dropped, while a show on another channel is kept.
  - A null runtime defaults to 60 minutes.
  - Programs for unknown channels are excluded.
  - A `fetchTvmaze` failure yields a guide with games only.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Verify. **Step 5:** Commit `feat(channels): guide listings from ESPN games and TVmaze`.

---

### Task 4: Guide screen and channel playback UI

**Files:**
- Create: `src/renderer/src/context/GuideContext.tsx`, `src/renderer/src/screens/GuideScreen/GuideScreen.tsx` + `.module.css`, `src/renderer/src/components/ChannelTile/ChannelTile.tsx` + `.module.css`, `src/renderer/src/lib/guide.ts` (time math, the current program for a channel)
- Modify: `App.tsx` (screen `'guide'`), `main.tsx` (GuideProvider), `components/TopBar/*` (Home · Guide nav, guide chips and search), `screens/PlayerScreen/PlayerScreen.tsx`, `components/PlayerDrawer/PlayerDrawer.tsx`, `components/LoadingState/LoadingState.tsx`, `env.d.ts` (the `window.onair` additions)

**Behavior:**
- **Guide grid:**
  - A 64px row per channel, and a 220px sticky channel column: a monogram tile in a name-hashed color, the name, and `N src` in mono.
  - The ruler starts at `floor(now to 30min)` with 30-minute ticks at 240px per hour, and scrolls horizontally to +12h.
  - The now-line is red and updates every 30 seconds.
  - Blocks: the current program is brighter. Live games show a red dot, `Away 3 – 2 Home` and a team-color left edge. Unknown time reads "Live".
  - Click a channel tile or a current block to tune in.
- **Filtering:** category chips and search come from the top bar, filtering by name. Empty state: "No channels found yet", with a Refresh button that calls `refreshChannels()`.
- **Player, when the id starts with `ch:`:**
  - Resolve the channel and the current and next programs from GuideContext.
  - Title = channel name. Meta = `On now: {title}`, or "Live".
  - Drawer: if the current program has a `gameId` of a known game, show that game's Scoreboard; otherwise On now / Up next cards.
  - Loading and error use a `title` prop when there's no game.

- [ ] Steps: implement → typecheck, lint → run the app with `ONAIR_FIXTURE=1` and screenshot the guide, a fixture channel tuned in, and a stall → failover on a channel → commit `feat(ui): guide and live channels`.

---

### Task 5: Verify, document, ship

- [ ] Full test suite, typecheck and lint pass.
- [ ] Tune one real discovered channel. Record which sources carried it.
- [ ] Docs: `docs/DATABASE.md` (the new tables and the `stream_candidates` change), `docs/IPC_API.md` (new channels), `docs/ADAPTERS.md` (`channels` config).
- [ ] PR, merge, `npm run install:local`.
