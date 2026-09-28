# OnAir UI redesign: cinematic direction

Date: 2026-09-27
Status: approved in chat
Reference mockup: `2026-09-27-ui-directions-mockup.html`, direction C

## Goal

Make OnAir feel like a premium streaming app (YouTube TV / Apple TV class) instead of a styled web page. Playback behavior does not change.

## Shell and system

- `titleBarStyle: 'hiddenInset'`, traffic lights inside our top bar, `backgroundColor` matching `--bg`.
- The sidebar is removed. A floating top bar holds the wordmark, a segmented league filter (All plus in-season leagues; red dot on leagues with live games), and Diagnostics at the far right. It becomes frosted once content scrolls under it.
- Geist and Geist Mono are bundled locally (no network font loading). Mono is used only for clocks, stats and diagnostics.
- Palette: neutral near-black. White is the primary action, red means live only, and team colors carry the rest.
- One ease curve (`cubic-bezier(.32,.72,0,1)`), durations 200–450ms, and `prefers-reduced-motion` is respected.
- Dark only.

## Home

- **Hero:** the featured game, chosen as the first live game, else starting soon, else next scheduled. It shows a blurred two-team color wash, large logos, the score (live/final) or kickoff time, a status pill (`Live · Q3 4:12 · CBS`), and a white Watch button. When more than one game is live, pager dots appear and the hero auto-advances every 8s, pausing on hover.
- **Rows:** Live now, Starting soon, Later today, Tomorrow, This week, Recently ended. Each is a horizontal scroll row with snap, arrow buttons on hover, and is hidden when empty.
- **Tiles:** team color at the edges fading to a dark center; logos use the ESPN dark variant (`/500-dark/`) with fallback to the standard logo and then a monogram disc, on a soft plate. Hover lifts the tile and reveals Watch. Keyboard: tiles are focusable buttons with a visible focus ring.
- **States:** skeleton hero and rows while loading, an honest empty state, and an inline error state.

## Player

- Full-bleed video using the existing dual `<video>` elements; only their styling changes.
- Top overlay: back, title, status. Bottom overlay: mute, volume, LIVE / jump to live, behind-live readout, fullscreen. Both auto-hide after 3s idle.
- **Drawer:** a frosted right panel that pushes the video rather than covering it. It contains the scoreboard (score and clock), stream chips (quality, behind live, on-air time, failovers this session), and the source list with the active source highlighted. `R` toggles it and the state persists in localStorage. In fullscreen it becomes an overlay.
- **Loading:** team-color wash, both logos, "Finding the best stream…", and an indeterminate shimmer. The hardcoded "Checking 3 sources" is removed.
- **Failover toast:** a frosted pill at top-center reading "Switched to {source}".
- **Error:** a frosted card with the existing reason-specific headings, plus Retry, Pick a source, and Back. The Diagnostics link becomes real navigation.

## Diagnostics

Same shell, with a large title and a refresh button. Sources render as cards showing health, a confidence meter, enabled state, and last updated. Events render as a timeline showing type, details, and relative time.

## Data plumbing

- `Game` gains optional fields: `away?: TeamInfo`, `home?: TeamInfo`, `statusDetail?: string`, `network?: string`, `venue?: string`.
- `TeamInfo = { abbr, shortName, color, altColor, logo, score, record }`. Every field except `abbr` and `shortName` is nullable.
- The normalizer extracts these from the ESPN scoreboard event.
- Migration v2 adds a `detail_json TEXT` column to `games`. `upsertGame` writes it and `rowToGame` reads it. A null or invalid value means the fields are absent.
- `env.d.ts` mirrors the types.
- Scores refresh at the existing live poll cadence (60s).

## Out of scope

Playback logic (`usePlayback`, stall machine, continuity, failover), search, and light mode.

## Verification

- Extended normalizer and migration tests.
- `npm test`, `npm run typecheck`, `npm run lint`.
- Run the app with `ONAIR_FIXTURE=1` and screenshot home, loading, playing, failover toast, error and diagnostics.
- `never-black` browser test still passes.
