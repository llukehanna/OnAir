# Live channels and guide

Date: 2026-09-28
Status: approved in chat

## Goal

Let the viewer tune straight to 24/7 channels (ESPN, FS1, CNN…) that the built-in sources carry, with a TV guide showing what's on. Channels get the same failover, continuity and off-air handling as games.

## Decisions

- **Lineup:** every channel the sources list (sports, news, entertainment, other), discovered from the sources rather than hand-curated.
- **What's on:** ESPN games we already poll, placed on their network's channel, plus TVmaze's free US schedule for studio and entertainment shows. Where neither has data, the guide says "Live".
- **Architecture:** a watch target that is either a game or a channel. Everything past candidate collection (probe, rank, proxy, failover, continuity, off-air) is unchanged.

## Data model

```ts
type ChannelCategory = 'sports' | 'news' | 'entertainment' | 'other'

interface Channel {
  channelId: string          // 'ch:espn2'
  name: string               // 'ESPN2'
  category: ChannelCategory
  sourceCount: number        // sources currently carrying it
  lastSeenAt: number         // ms; last discovery run that listed it
}

interface ChannelSourceLink {
  channelId: string
  sourceId: string
  url: string                // the source's page for this channel
  label: string              // the source's own label, e.g. 'ESPN 2 HD'
  seenAt: number
}

interface GuideProgram {
  channelId: string
  title: string
  subtitle?: string
  start: number
  end: number
  kind: 'game' | 'show'
  gameId?: string
}

interface GuideData {
  channels: Channel[]
  programs: GuideProgram[]
  generatedAt: number
}

type WatchTarget =
  | { kind: 'game'; id: string; scope: LeagueId; game: Game }
  | { kind: 'channel'; id: string; scope: 'channel'; channel: Channel }
```

- Migration 3 adds `channels` and `channel_sources`.
- Migration 3 rebuilds `stream_candidates` without its foreign key to `games`. The `game_id` column keeps its name and now holds any target id.
- Reliability history is keyed by `(source, scope)`, where scope is a league or `'channel'`.

## Discovery

- `SourceAdapter` gains two optional methods:
  - `listChannels(pool): Promise<{ label; url }[]>`
  - `getChannelStreams(url, pool): Promise<RawStreamCandidate[]>`
- `InterceptAdapter` implements both from optional config: `channels: { listUrl, linkPatterns? }`.
- The four channel-listing sources (streamsports99, ntv.st, zlive.st, famelack) get that config after inspecting their pages.
- `canonicalChannel(label)` returns `{ channelId, name, category }`, or `null` for labels that aren't channels (anything with "vs"/"at", navigation text, and so on). It:
  - strips HD/FHD/UHD/4K, USA/US, East/West, Live and punctuation
  - applies a small variant table (Fox Sports 1 → FS1, ESPN 2 → ESPN2…)
  - assigns a category from known sets
- A channel scheduler runs at startup and every 30 minutes at `background` pool priority. It upserts channels and links, and drops links not seen in 24 hours.
- The fixture source lists two channels, so the whole flow works offline in dev.

## Listings

- TVmaze `GET /schedule?country=US&date=<today|tomorrow>` → programs. Airstamp plus runtime, defaulting to 60 minutes. Network names go through `canonicalChannel`.
- Games map to their network's channel, with durations estimated per league: NFL 195, CFB 210, MLB 180, NBA 150, CBB 120 minutes. A game replaces any TVmaze program it overlaps on the same channel.
- Refreshed every 30 minutes and on each games update. Served by IPC `get-guide` and pushed as `guide-updated`.

## Playback

- `PlaybackManager.play(id)` resolves the id to a target: ids starting `ch:` look up the channel, anything else is a game.
- For a channel, candidate collection asks every eligible adapter that has a link for the channel to `getChannelStreams(link.url)`. Match confidence is 1.0, since the page is the channel itself.
- Events and the candidate cache use the target id.
- The renderer's `playGame(id)` works unchanged with channel ids.

## UI

- **Top bar:** primary navigation **Home · Guide**. The league filter shows only on Home. On Guide, the bar shows category chips (All · Sports · News · Entertainment · Other) and a search field.
- **Guide screen:**
  - A sticky channel column with a monogram tile (name-hashed color) and a source count.
  - A sticky time ruler starting at the current half hour, 30-minute ticks, horizontally scrollable to +12h.
  - A red now-line.
  - Program blocks; live games show a red dot and the score.
  - Clicking a channel or its current program tunes in. Future programs show their time on hover.
- **Player on a channel:**
  - The title is the channel name, with the meta line "On now: {program}".
  - The drawer shows the game's scoreboard when the current program is a game, otherwise On now / Up next cards, plus stream stats and sources.
  - Loading and error states take a title instead of requiring a game.
- **Empty guide:** before the first discovery run, or with no channel sources, the guide says so and offers a refresh.

## Out of scope

Favorites, recording/DVR, per-channel logos from an external source, and listings beyond TVmaze's US schedule.

## Verification

- **Unit tests:** canonicalization, listing merge, target resolution, migration 3, channel-page parsing from saved HTML samples, and manager `play('ch:…')` with a fixture adapter.
- `npm test`, `npm run typecheck`, `npm run lint`.
- Run the app with `ONAIR_FIXTURE=1`: open the guide, tune a fixture channel, force a stall to show failover on a channel, then tune a real channel.
