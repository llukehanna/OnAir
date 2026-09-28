# OnAir Cinematic UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OnAir's renderer UI with the approved cinematic direction (C) and plumb real ESPN team data (logos, colors, scores, clock) through to it.

**Architecture:** Task 1 extends the main-process data path (normalizer → `games.detail_json` → `Game` optional fields) behind optional types so nothing downstream breaks. Tasks 2–6 rewrite the renderer's visual layer: new tokens and fonts, a top-bar shell replacing the sidebar, and the Home, Player and Diagnostics screens. Playback hooks stay untouched; only the presentation around the two `<video>` elements changes.

**Tech Stack:** Electron 34, React 18, TypeScript, CSS Modules, electron-vite, Jest (run under Electron's Node), better-sqlite3, lucide-react, `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (new).

**Spec:** `docs/superpowers/specs/2026-09-27-ui-cinematic-redesign-design.md`

## Global Constraints

- Playback logic (`usePlayback.ts`, `playback/*`, `src/main/playback/*`) is not modified.
- Both `<video>` elements stay mounted for the whole player lifetime; visibility is controlled only by `slot0IsActive` and `playerState`, as today.
- New `Game` fields are optional; every consumer tolerates their absence.
- Fonts load from the bundle, never the network.
- Dark only. Red (`--live`) is used only for live state; white is the primary action.
- Motion uses `--ease: cubic-bezier(.32,.72,0,1)`, 200–450ms; `prefers-reduced-motion` disables transforms and auto-advance.
- Verification commands: `npm test`, `npm run typecheck`, `npm run lint`.

---

## File map

Main process
- Modify `src/main/types.ts`: add `TeamInfo`, optional fields on `Game`.
- Modify `src/main/discovery/normalizer.ts`: extract team/game detail.
- Modify `src/main/db/migrations.ts`: migration v2 adds `games.detail_json`.
- Modify `src/main/db/queries/games.ts`: write/read `detail_json`.
- Modify `src/main/index.ts`: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition`, `backgroundColor`.
- Tests: `tests/discovery/normalizer.test.ts`, `tests/db/migrations.test.ts`, `tests/db/queries/games.test.ts`.

Renderer (`src/renderer/src/`)
- Modify `env.d.ts`: mirror `TeamInfo` and `Game` fields.
- Rewrite `styles/tokens.css`: new palette, type, motion, base styles.
- Modify `main.tsx`: import fonts.
- Create `lib/teams.ts`: `teamOf(game, side)`, `darkLogo(url)`, `leagueLabel`, `LEAGUE_ORDER`.
- Create `lib/time.ts`: `formatKickoff`, `dayBucket`, `formatRelative`, `formatDuration`.
- Create `components/TeamLogo/`: logo with dark variant → standard → monogram fallback.
- Create `components/TopBar/`: wordmark, league filter, Diagnostics.
- Create `components/Hero/`: featured game with pager.
- Create `components/Row/`: horizontal scroll row with arrows.
- Create `components/GameTile/`: team-color tile.
- Rewrite `screens/HomeScreen/`.
- Rewrite `screens/PlayerScreen/`, `components/PlayerControls/`, `components/SourceSwitcher/` (becomes `SourceList`), `components/LoadingState/`, `components/FailoverToast/`.
- Create `components/PlayerDrawer/`.
- Rewrite `screens/DiagnosticsScreen/`.
- Modify `App.tsx`, `App.module.css`: shell without sidebar; Diagnostics navigation from error state.
- Modify `hooks/useKeyboardShortcuts.ts`: remove the `F`/`Escape` handling that PlayerScreen now owns.
- Delete `components/Sidebar/`, `components/GameCard/`, `screens/Player.tsx` (unused).

---

### Task 1: Plumb ESPN team detail through main process

**Files:**
- Modify: `src/main/types.ts`, `src/main/discovery/normalizer.ts`, `src/main/db/migrations.ts`, `src/main/db/queries/games.ts`, `src/renderer/src/env.d.ts`
- Test: `tests/discovery/normalizer.test.ts`, `tests/db/migrations.test.ts`, `tests/db/queries/games.test.ts`

**Interfaces:**
- Produces (in both `src/main/types.ts` and `env.d.ts`):

```ts
interface TeamInfo {
  abbr: string
  shortName: string
  color: string | null      // '#rrggbb' or null
  altColor: string | null   // '#rrggbb' or null
  logo: string | null       // absolute https URL
  score: number | null      // null before kickoff
  record: string | null     // e.g. '3-0'
}
interface Game {
  // existing fields unchanged
  away?: TeamInfo
  home?: TeamInfo
  statusDetail?: string     // ESPN status.type.shortDetail, e.g. 'Q3 - 4:12', 'Halftime', 'Final'
  network?: string          // first broadcast name, e.g. 'NBC'
  venue?: string
}
```

- `upsertGame(game, rawData?, db?)` persists the detail fields as JSON in `games.detail_json`; `rowToGame` restores them. Invalid or null JSON yields a `Game` without them.

- [ ] **Step 1: Write failing normalizer tests**

Extend `makeEspnEvent` so competitors carry `score`, `records`, and team `shortDisplayName`, `color`, `alternateColor`, `logo`, and the competition carries `status.type.shortDetail`, `broadcasts`, `venue`. Add:

```ts
it('extracts team detail, status detail, network and venue', () => {
  const [game] = normalizeEvents([makeEspnEvent({ rich: true })], 'nfl')
  expect(game.away).toEqual({
    abbr: 'BOS', shortName: 'Celtics', color: '#007a33', altColor: '#ffffff',
    logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png', score: 88, record: '40-12',
  })
  expect(game.home?.abbr).toBe('LAL')
  expect(game.home?.score).toBe(91)
  expect(game.statusDetail).toBe('Q3 - 4:12')
  expect(game.network).toBe('ESPN')
  expect(game.venue).toBe('Crypto.com Arena')
})

it('leaves detail null-safe when ESPN omits optional fields', () => {
  const [game] = normalizeEvents([makeEspnEvent()], 'nba')
  expect(game.away).toEqual({
    abbr: 'BOS', shortName: 'Boston Celtics', color: null, altColor: null, logo: null, score: null, record: null,
  })
  expect(game.statusDetail).toBeUndefined()
  expect(game.network).toBeUndefined()
})

it('treats a scheduled game score of "0" as no score', () => {
  const [game] = normalizeEvents([makeEspnEvent({ rich: true, statusName: 'STATUS_SCHEDULED', date: new Date(Date.now() + 86_400_000).toISOString() })], 'nba')
  expect(game.away?.score).toBeNull()
})
```

- [ ] **Step 2: Run** `npm test -- tests/discovery/normalizer.test.ts`. Expected: new tests FAIL (`game.away` undefined).

- [ ] **Step 3: Implement.** Widen `EspnEvent` with optional fields; add `toTeamInfo(competitor, hasStarted)`:

```ts
function hex(c: string | undefined): string | null {
  return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : null
}
function toTeamInfo(c: EspnCompetitor, started: boolean): TeamInfo {
  const score = started && c.score !== undefined && c.score !== '' ? Number(c.score) : null
  return {
    abbr: c.team.abbreviation,
    shortName: c.team.shortDisplayName ?? c.team.displayName,
    color: hex(c.team.color),
    altColor: hex(c.team.alternateColor),
    logo: c.team.logo ?? null,
    score: score !== null && Number.isFinite(score) ? score : null,
    record: c.records?.[0]?.summary ?? null,
  }
}
```

`started` is `status !== 'SCHEDULED' && status !== 'STARTING_SOON'`. Set `statusDetail` from `competition.status.type.shortDetail`, `network` from `competition.broadcasts?.[0]?.names?.[0]`, `venue` from `competition.venue?.fullName`, each only when present.

- [ ] **Step 4: Run** normalizer tests. Expected: PASS.

- [ ] **Step 5: Failing DB tests.** In `migrations.test.ts`: `games` has a `detail_json` column (`PRAGMA table_info(games)`), and `schema_version` contains version 2. In `games.test.ts`: round-trip a game with `away`/`home`/`statusDetail`/`network`/`venue` through `upsertGame` → `getGameById` and expect deep equality; a row with `detail_json = 'not json'` returns a game with `away` undefined.

- [ ] **Step 6: Run** DB tests. Expected: FAIL.

- [ ] **Step 7: Implement.** Migration `{ version: 2, name: 'games_detail_json', up: db => db.exec('ALTER TABLE games ADD COLUMN detail_json TEXT') }`. `upsertGame` writes `JSON.stringify({ away, home, statusDetail, network, venue })` when any is set, else null. `rowToGame` parses in try/catch and spreads defined keys only.

- [ ] **Step 8: Mirror types** in `env.d.ts` (exact definitions above).

- [ ] **Step 9: Run** `npm test && npm run typecheck && npm run lint`. Expected: all pass.

- [ ] **Step 10: Commit** `feat(discovery): keep ESPN team detail (logos, colors, scores, clock)`.

---

### Task 2: Foundations (fonts, tokens, window chrome, shared helpers)

**Files:**
- Modify: `package.json` (add `@fontsource-variable/geist@^5.3.0`, `@fontsource-variable/geist-mono@^5.3.0`), `src/renderer/src/main.tsx`, `src/renderer/src/styles/tokens.css`, `src/main/index.ts`
- Create: `src/renderer/src/lib/teams.ts`, `src/renderer/src/lib/time.ts`, `src/renderer/src/components/TeamLogo/TeamLogo.tsx`, `TeamLogo.module.css`

**Interfaces (produced):**

```ts
// lib/teams.ts
export const LEAGUE_ORDER: LeagueId[]                  // ['nfl','nba','cfb','cbb']
export function leagueLabel(l: LeagueId): string        // 'NFL','NBA','College Football','College Basketball'
export function leagueShort(l: LeagueId): string        // 'NFL','NBA','CFB','CBB'
export function teamOf(game: Game, side: 'away'|'home'): TeamInfo  // falls back to name-derived info
export function darkLogo(url: string | null): string | null        // '/500/' → '/500-dark/'
export function teamColor(t: TeamInfo, fallback: string): string

// lib/time.ts
export function formatKickoff(ms: number, now?: number): string    // '8:20 PM' today, 'Tomorrow 8:20 PM', 'Sat 12:00 PM'
export function dayBucket(ms: number, now?: number): 'today'|'tomorrow'|'week'|'later'
export function formatRelative(ms: number | null, now?: number): string // '12s ago'
export function formatDuration(sec: number): string                 // '42:18', '1:02:05'
export function countdown(ms: number, now?: number): string          // 'in 38 min', 'in 2 hr'

// TeamLogo
<TeamLogo team={TeamInfo} size={number} plate?={boolean} />
```

Token names (CSS custom properties) produced: `--bg`, `--bg-raised`, `--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--line`, `--line-strong`, `--glass`, `--glass-strong`, `--glass-line`, `--live`, `--ok`, `--warn`, `--bad`, `--font-sans`, `--font-mono`, `--ease`, `--dur-1` (200ms), `--dur-2` (320ms), `--dur-3` (450ms), `--radius-sm/md/lg/xl/pill`, `--topbar-h` (64px), `--z-overlay`, `--z-drawer`, `--z-toast`, `--z-topbar`.

- [ ] **Step 1:** `npm install @fontsource-variable/geist @fontsource-variable/geist-mono`; import both in `main.tsx`.
- [ ] **Step 2:** Rewrite `tokens.css` with the tokens above, base styles (`html,body,#root{height:100%}`, `-webkit-font-smoothing: antialiased`, `font-feature-settings`, `::selection`, thin overlay scrollbars, `:focus-visible` ring in white), the `pulse-live` and `shimmer` keyframes, and the reduced-motion block. Keep old token names used by not-yet-migrated modules aliased until Task 6 removes them.
- [ ] **Step 3:** `src/main/index.ts` BrowserWindow: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 20, y: 22 }`, `backgroundColor: '#0b0b0c'`.
- [ ] **Step 4:** Implement `lib/teams.ts`, `lib/time.ts`, `TeamLogo` (tries `darkLogo(team.logo)`, then `team.logo` on error, then a monogram disc filled with `team.color` showing `team.abbr`). `plate` renders a soft radial dark plate behind the logo so it separates from team-color backgrounds.
- [ ] **Step 5:** `npm run typecheck && npm run lint`. Commit `feat(ui): Geist, new tokens, inset title bar, team helpers`.

---

### Task 3: Shell and TopBar

**Files:** Create `components/TopBar/TopBar.tsx` + `.module.css`; modify `App.tsx`, `App.module.css`; delete `components/Sidebar/`.

**Interfaces:**

```ts
<TopBar
  screen={Screen}
  league={LeagueId | null}
  onLeague={(l: LeagueId | null) => void}
  onDiagnostics={() => void}
  onHome={() => void}
  scrolled={boolean}
/>
```

- Wordmark `OnAir` (Geist 600, -0.04em) with a small live tally dot that glows red only when any game is live. Left padding clears the traffic lights (88px).
- Segmented filter: All plus leagues from `LEAGUE_ORDER` having a game in the last 7 days or upcoming; red dot on leagues with live games. Selected segment is white pill with black text; animated via a sliding indicator.
- Right: Diagnostics icon button (`Activity`), active state when on diagnostics.
- The whole bar is `-webkit-app-region: drag`; interactive children `no-drag`.
- `scrolled` adds a frosted background (`backdrop-filter: blur(24px) saturate(1.6)`) and hairline.
- The TopBar is hidden on the player screen (the player has its own overlay).
- App shell: `main` is the scroll container; it reports `scrollTop > 8` to set `scrolled`.

- [ ] Steps: implement, remove Sidebar, `npm run typecheck && npm run lint`, commit `feat(ui): top bar shell replaces sidebar`.

---

### Task 4: Home (Hero, Row, GameTile)

**Files:** Create `components/Hero/`, `components/Row/`, `components/GameTile/`; rewrite `screens/HomeScreen/`; delete `components/GameCard/`.

**Interfaces:**

```ts
<Hero games={Game[]} onWatch={(id: string) => void} />   // games = featured candidates, first is shown
<Row title={string} count?={number} children />         // horizontal scroll with arrow buttons
<GameTile game={Game} onWatch={(id: string) => void} size?={'lg'|'md'} />
<HeroSkeleton /> <RowSkeleton />
```

- Featured: live games (sorted by start) → else starting soon → else next scheduled (one).
- Hero: height 440px; background is two radial washes of `teamColor(away)` and `teamColor(home)`, blurred and faded into `--bg`; subtle grain overlay. Grid `1fr auto 1fr`: away logo (120px, plated) + short name + record; center score (`88px` Geist 600 tabular, trailing team dimmed) or kickoff time; status pill (`● Live · {statusDetail} · {network}` or `{countdown} · {network}`); white `Watch` button (Play icon) and, for live, nothing else. Pager dots if more than one featured; auto-advance 8s, paused on hover or reduced motion; crossfade 450ms.
- Rows on Home (league-filtered): Live now (`lg` tiles), Starting soon, Later today, Tomorrow, This week, Recently ended (dimmed). Hidden when empty.
- Row: header title (18px 600) and count in mono; scroller with `scroll-snap-type: x mandatory`, hidden scrollbar, edge fade masks, prev/next circular glass buttons visible on row hover, disabled at the ends. Scroller left padding aligns with page gutter (48px).
- GameTile: `lg` 300×168, `md` 236×132. Background: `linear-gradient(115deg, away 0 50%, home 50% 100%)` then a radial dark vignette in the center (`radial-gradient(closest-side, #0b0b0ccc, transparent)`) so logos sit on dark; bottom gradient for the caption. Logos plated. Caption: `Away 21 – 10 Home` (scores only when not null) and a sub-line (`statusDetail` for live, `formatKickoff · network` otherwise). Live chip bottom-right. Hover: `translateY(-4px) scale(1.02)`, ring `--glass-line`, a centered Play affordance fades in. Button semantics with an `aria-label` like `Chiefs at Dolphins, live, Q3 4:12`.
- Empty state: centered, "Nothing on right now", next kickoff time if any. Error state: "Couldn't reach the schedule. Retrying." inline banner.

- [ ] Steps: implement, delete GameCard, `npm run typecheck && npm run lint`, run the app (`ONAIR_FIXTURE=1 npm run dev`) and screenshot home; commit `feat(ui): cinematic home with hero and rows`.

---

### Task 5: Player

**Files:** Rewrite `screens/PlayerScreen/`, `components/PlayerControls/`, `components/LoadingState/`, `components/FailoverToast/`; create `components/PlayerDrawer/`; rename `components/SourceSwitcher/` → `components/SourceList/`; modify `hooks/useKeyboardShortcuts.ts`, `App.tsx`.

**Interfaces:**

```ts
<PlayerScreen ...existing props... onOpenDiagnostics={() => void} />
<PlayerControls videoRef title status visible latency onJumpLive isFullscreen onToggleFullscreen onToggleDrawer drawerOpen />
<PlayerDrawer game={Game | undefined} open={boolean} overlay={boolean} stream={{ source: string | null; quality: string | null; latency: number | null; onAirSec: number; failovers: number }}>
  <SourceList gameId activeCandidateId onSelect />
</PlayerDrawer>
<SourceList gameId={string} activeCandidateId={string | null} onSelect={(id: string) => Promise<boolean>} refreshKey={unknown} />
<LoadingState game={Game | undefined} />
<AllSourcesFailed game reason onRetry onPickSource onBack onOpenDiagnostics />
<FailoverToast />
```

- Layout: `.stage` (flex:1, black, relative) holds both videos (`object-fit: contain`, absolute inset 0, unchanged display logic), overlays, loading and error. `.drawer` (width 380px) sits to the right; closed → width 0 with a 450ms width transition; the video area resizes with it. In fullscreen the drawer is absolutely positioned over the stage.
- Fullscreen: real `document.documentElement.requestFullscreen()`; `isFullscreen` tracks `fullscreenchange`. `F` toggles, double-click toggles, `Escape` exits fullscreen else goes back, `R` toggles the drawer (persist `onair.drawer`), `M` mute, Space play/pause. Remove `F`/`Escape` from `useKeyboardShortcuts`.
- Overlays: top gradient with a round glass back button, `Away at Home` title (17px 600), and a meta line (`● Live · {statusDetail} · {network}`). Bottom gradient with controls. Visible on mouse move, hidden after 3s idle; always visible when not playing. Cursor hides with overlays.
- Controls: play/pause-free (live), mute + volume slider (custom styled range, white fill), `LIVE` button (red dot when within 10s of live edge, else grey "Go live" which seeks to `video.duration - 3`), behind-live readout in mono, spacer, drawer toggle (`PanelRight`), fullscreen toggle.
- Drawer: frosted panel (`--glass-strong`, blur 40px). Scoreboard (logos 56px plated, score 40px, status detail, network · venue). Stream chips: quality, behind live, on-air duration (ticks each second since first `playing`), failovers (count `source_switch` playback events for this game since mount). Sources: SourceList rows (source name, quality, reliability bar, active = white row with black text). Footer keyboard hints.
- Loading: team-color wash (same as Hero), both logos plated, "Finding the best stream", sub-line with game title, indeterminate shimmer bar 200px.
- Error: frosted card centered; heading from existing `headingFor`; buttons Retry (white), Pick a source (glass, opens drawer), Back; "View details in Diagnostics" calls `onOpenDiagnostics`.
- FailoverToast: frosted pill top-center, `ArrowLeftRight` icon, "Switched to {sourceName}", slide/fade in, 3.2s.

- [ ] Steps: implement, `npm run typecheck && npm run lint`, run app, screenshot loading/playing/drawer closed/fullscreen; trigger `window.onair.fixtureSetMode('stall')` and screenshot toast; `fixtureSetMode('manifest-404')` enough to reach the error card; commit `feat(ui): immersive player with drawer`.

---

### Task 6: Diagnostics and cleanup

**Files:** Rewrite `screens/DiagnosticsScreen/`; delete `screens/Player.tsx`; remove legacy token aliases from `tokens.css`; restyle `ErrorBoundary` with tokens.

- Page: 48px gutter, top padding clears the top bar. Title `Diagnostics` (40px 600 -0.04em) with a subline "{n} sources · last event {relative}", refresh glass button right.
- Sources: grid of cards (`minmax(280px,1fr)`): name, health dot + label (healthy `--ok`, degraded `--warn`, blocked/broken `--bad`, unknown `--ink-3`), confidence meter bar with mono %, enabled toggle-look indicator, last updated relative.
- Events: timeline list; each row has a colored dot on a vertical hairline, a type label (humanized), details (`k: v` joined, mono, `--ink-3`), time right-aligned mono.
- Auto-refresh every 10s while mounted, in addition to the button.

- [ ] Steps: implement, `npm test && npm run typecheck && npm run lint`, screenshot; commit `feat(ui): diagnostics redesign, remove dead components`.

---

### Task 7: Verification and docs

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:browser` all pass.
- [ ] Run the app with `ONAIR_FIXTURE=1 npm run dev`; capture home, player, diagnostics into `docs/media/home.png`, `player.png`, `diagnostics.png` (1440×900).
- [ ] Commit `docs: refresh screenshots for the redesign`.
