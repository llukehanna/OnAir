# Database

SQLite through `better-sqlite3`, owned by the main process.
The file is `onair.db` in Electron's `userData` directory.
Schema changes are versioned migrations in `src/main/db/migrations.ts`, applied in a transaction at startup and tracked in `schema_version`.

The database starts empty: no sources are seeded.

## Tables

### `games`

What discovery has seen. Upserted on every ESPN poll.

| Column | Type | Notes |
|---|---|---|
| `game_id` | TEXT PK | `${league}_${espnEventId}` |
| `league` | TEXT | `nba`, `nfl`, `mlb`, `nhl`, `cbb`, `cfb` |
| `team_home`, `team_away` | TEXT | ESPN display names |
| `start_time` | INTEGER | Unix ms |
| `status` | TEXT | `LIVE`, `STARTING_SOON`, `SCHEDULED`, `RECENTLY_ENDED` |
| `raw_data` | TEXT | This game's own ESPN event JSON; diagnostic only |
| `detail_json` | TEXT | Display detail kept from ESPN: per-team abbreviation, short name, colors, logo, score, record; plus status detail, network, venue, round headline. Null when ESPN sent none. Added in migration 2 |
| `cached_at` | INTEGER | Last time a poll returned it |

Indexed on `status`, `league`, `start_time`.
The top bar's league filter only offers leagues that have games in the schedule, so an off-season league drops out and returns once its new season's games appear.

### `sources`

One row per stream source. An adapter only produces candidates when its row exists and isn't `broken` or `blocked`.

| Column | Type | Notes |
|---|---|---|
| `source_id` | TEXT PK | Matches `SourceAdapter.sourceId` |
| `name`, `base_url` | TEXT | |
| `classification` | TEXT | `event_first`, `channel_first`, `mixed_aggregator` |
| `supported_leagues` | TEXT | JSON array |
| `extraction_method` | TEXT | `network_intercept`, `html_parse`, `api` |
| `confidence_weight` | REAL | 0–1 |
| `health_state` | TEXT | `healthy`, `degraded`, `blocked`, `broken`, `unknown` |
| `health_updated_at` | INTEGER | |
| `enabled` | INTEGER | 0/1 |
| `needs_adapter` | INTEGER | 1 for sources added by URL that have no adapter yet |
| `added_at` | INTEGER | |

### `source_reliability`

What scoring learns from. One row per source per league, written by playback.

| Column | Notes |
|---|---|
| `startup_successes`, `startup_failures` | Did a chosen stream reach its first frame |
| `total_startup_time_ms` | For average startup speed |
| `buffer_events` | Stalls while playing |
| `switch_events` | Times playback failed over away from this source |
| `total_sessions` | |
| `consecutive_failures` | Reset on success |
| `last_updated` | |

`UNIQUE(source_id, league)`, with a foreign key to `sources`.
The scoring formula in [ARCHITECTURE.md](ARCHITECTURE.md#confidence-and-scoring) reads these. A source with no row scores a neutral 0.5 on the history terms.
`league` holds a `LeagueId` for a game source, or the literal `'channel'` — channels share one history bucket across leagues rather than getting a row per league, since a channel has no league of its own. Added in migration 3.

### `channels`

24/7 channels discovered from sources' channel-listing pages. Upserted by the channel discovery scheduler (`src/main/channels/scheduler.ts`), which runs at startup and every 30 minutes. Added in migration 3.

| Column | Type | Notes |
|---|---|---|
| `channel_id` | TEXT PK | `ch:<slug>`, e.g. `ch:espn2`. The `ch:` prefix keeps channel ids out of the game id space |
| `name` | TEXT | Canonical display name, e.g. `ESPN2` |
| `category` | TEXT | `sports`, `news`, `entertainment`, `other` |
| `last_seen_at` | INTEGER | Last discovery run that any source listed it in |

The `Channel` type's `sourceCount` is computed from `channel_sources` on read, not stored.

### `channel_sources`

One row per (channel, source) link: which sources currently carry a channel, and where. Added in migration 3.

| Column | Type | Notes |
|---|---|---|
| `channel_id`, `source_id` | TEXT | |
| `url` | TEXT | The source's own page for this channel |
| `label` | TEXT | The source's own listing text, kept for display/debugging |
| `seen_at` | INTEGER | Last discovery run in which this source listed this channel |

`PRIMARY KEY(channel_id, source_id)`. Foreign keys to `channels` (`ON DELETE CASCADE`) and `sources`.
A link not refreshed within 24 hours is deleted; a channel left with no links afterward is deleted too. Deletion only ever prunes on age — a source's listing coming back empty on one pass doesn't drop its links immediately.

### `stream_candidates`

Probe history: one row per probed candidate, with `stream_url`, `stream_type`, `quality`, `score`, `probe_success`, `probe_latency_ms`, and `probed_at`.
Foreign key to `sources`.

`game_id` holds any watch target's id, despite the column name: a game id, or a channel id (`ch:<slug>`). Migration 3 dropped its foreign key to `games` — a channel id is never a row there — by rebuilding the table (SQLite can't drop a constraint in place) and copying every existing row across unchanged.

The live, ranked candidate list is held in memory by the URL cache, not read from here.

### `events`

Append-only log behind the Diagnostics screen.

| Column | Notes |
|---|---|
| `event_type` | e.g. `stream_started`, `stream_failed`, `source_switch`, `all_sources_failed`, `api_failure` |
| `game_id`, `source_id` | nullable |
| `details` | JSON string, e.g. `{"reason":"stall"}` |
| `occurred_at` | Unix ms |

Indexed on `event_type`, `occurred_at`, `source_id`.

## Maintenance

On startup (`src/main/db/maintenance.ts`):

- finished games that started more than 7 days ago are deleted
- events older than 30 days are deleted, with a hard ceiling of 50,000 rows
- `VACUUM` runs only when at least 16 MB is reclaimable, since it rewrites the whole file
