# Failover

The goal: **the viewer never sees black and never has to intervene.**
A stream that stalls, errors, expires, or goes off-air is replaced with the next best candidate without a visible gap.

## The never-black invariant

> While a switch is in flight, the currently visible video element keeps playing.
> It is torn down only after the replacement has produced a confirmed first frame, or after the terminal failure state is reached.

That is why there are two paths, not one:

| Path | Destroys the current stream | Trigger |
|---|---|---|
| `play(gameId)` | immediately | the user picked a different game |
| `failover(gameId, reason)` | only after the replacement's first frame | stall, fatal error, expiry, off-air |
| `selectStream(candidateId)` | only after the replacement's first frame | the user picked a different source |

The invariant can be asserted directly, and the browser test tier does so with a real decoder (see [Testing](#testing)).
During a switch, the visible element never drops below `readyState 2`, and its playback position only moves forward.

## Detecting failure

Three independent detectors, because each failure hides from the other two.

### Stalls — renderer

`stall-machine.ts` is an explicit two-state machine, `watching` and `stalled`:

- `BUFFER_STALL_ERROR` moves to `stalled` and arms **one** 3-second timer
- `BUFFER_APPENDED` moves back to `watching` and clears it
- if the timer fires, it requests failover with reason `stall`

hls.js emits `BUFFER_STALL_ERROR` repeatedly while stalled.
Without the explicit state, each event would arm its own timer and request its own failover.

### Fatal errors — renderer

`error-classify.ts` maps a fatal hls.js error to an action.
The most important distinction: **a 403 on a segment after the stream has played is an expired CDN token, not a dead source.**

| Error | Action |
|---|---|
| Non-fatal | ignore; hls.js recovers on its own |
| 403/410 on a segment, after the first frame | `reextract`: refresh this source's URL and stay on it (at most twice) |
| 403/410 on a segment, before any frame | `failover`: never authorized, re-extracting won't help |
| 404/410 on a playlist | `failover-degrade`: the source stopped publishing; demote it |
| Timeout | `failover` |
| Media or remux error | `failover-degrade`: the source serves something undecodable |
| Anything else fatal | `failover` |

The classifier takes plain objects shaped like hls.js errors and never imports hls.js, so it's tested under Node.

### Off-air — main process

A source can return 200 on the manifest and every segment while showing nothing: an off-air slate, an ad loop, a frozen encoder.
hls.js sees no error, and the buffer stays fed, so the stall machine never fires.

The tell is the live edge.
Every 20 seconds, `off-air.ts` fetches the playing playlist twice, 2.5 seconds apart, and compares `#EXT-X-MEDIA-SEQUENCE`.
A live stream advances; a dead one serves the identical manifest forever.
A frozen verdict triggers failover with reason `off_air`.
A failed check returns `unknown` and does nothing, because refusing to play on a broken diagnostic would be worse than the problem it detects.

Out of scope on purpose: detecting that a stream shows the *wrong game*.
That needs video understanding, and guessing would be worse than not answering.

## The escalation ladder

`failover-session.ts` holds per-game state: the ranked candidates, which have been tried, the current rung, and an in-flight lock.

```
next untried candidate
   │ none left
   ▼
one fresh extraction (cached URLs may all be expired tokens, not dead sources)
   │ nothing playable
   ▼
embedded player (WebContentsView), verified by watching <video>.currentTime advance
   │ never starts
   ▼
all_sources_failed: an honest error screen with Retry
```

- **Concurrent triggers collapse.** A renderer stall timeout and a main-side off-air check can land in the same instant. The in-flight lock turns them into one switch. The stall machine collapses renderer-side repeats but can't see main-side requests, so the lock lives in main too.
- **Re-extraction happens once per session.** A second pass would just be a retry loop holding a frozen frame.
- **The embedded tier is verified, not assumed.** Loading a page is not playing it. This is the last rung, so a false positive would strand the viewer on a page that never plays.
- **Manual picks don't survive death.** A user-selected source that fails is failed over like any other. The pick is a starting preference; staying on air wins. The toast says what happened.

Every outcome is written to `source_reliability` and `events`, which is what lets scoring learn which sources hold up.

## Continuity across the swap

Sources sit at different distances behind live; 45 versus 100 seconds is ordinary.
Switching naively jumps the viewer back (re-watching a play) or forward (missing one).

When both streams carry `#EXT-X-PROGRAM-DATE-TIME`, `continuity.ts` maps the outgoing element's position to the wall-clock instant on screen, then seeks the replacement to the same instant before it becomes visible.
If the replacement doesn't hold that instant, the target is clamped to the nearest content it does have, and the result is flagged as `clamped`.
Without program dates on both sides, the replacement joins at its live edge.

Volume and mute are copied onto the incoming element before the swap.

## The staging handoff

`usePlayback.ts`, in order:

1. Attach the new stream to whichever `<video>` is currently hidden (staging).
2. Record its fragments as they load, for continuity.
3. On the **first** `FRAG_CHANGED`: copy volume and mute, seek for continuity, destroy the old hls.js instance, flip which element is visible.
4. If no frame arrives within 15 seconds, the attempt is reported as failed.

Everything after the first fragment is ignored for swap purposes, so a replacement can't swap twice.

## Testing

The fixture source (`src/main/dev/hls-fixture.ts`) is a local HLS origin with a sliding live window that can be commanded to fail the way real sources do:

| Mode | Behaviour | Exercises |
|---|---|---|
| `stall` | accepts segment requests and never answers | stall machine → failover |
| `segment-403` | segments return 403 | token-expiry classification → re-extract |
| `manifest-404` | playlist returns 404 | source-gone classification → next candidate |
| `off-air` | freezes the media sequence | off-air detection → failover |
| `slow` | delays responses | timeouts |

Run the app with `ONAIR_FIXTURE=1` and call `window.onair.fixtureSetMode(mode)` from DevTools to watch any of these in the real UI.

`tests/browser/never-black.test.ts` runs Chromium against real MPEG-TS segments and samples both video elements through a swap.
It asserts:

- the visible element never drops below `readyState 2`
- the position advances monotonically
- volume and mute carry over
- a slot change actually happened, so the assertions aren't vacuous
- the old stream stays up while the replacement is loading
- the swap survives the outgoing stream dying mid-switch

```bash
npm run setup:browser   # one-time
npm run test:browser
```
