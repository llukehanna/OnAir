// Guide time math and channel ordering. Pure functions, no DOM, no globals —
// the Jest suite (tests/renderer/guide.test.ts) compiles this file outside the
// renderer's tsconfig, so the shapes it needs are declared structurally here
// rather than borrowed from the ambient types in env.d.ts.

export type GuideCategory = 'all' | 'sports' | 'news' | 'entertainment' | 'other'

/** The id prefix that marks a watch target as a 24/7 channel rather than a game. */
export const CHANNEL_ID_PREFIX = 'ch:'

export interface ChannelLike {
  channelId: string
  name: string
  category: Exclude<GuideCategory, 'all'>
}

export interface ProgramLike {
  channelId: string
  start: number
  end: number
}

export const SLOT_MS = 30 * 60_000
export const HOUR_MS = 60 * 60_000
/** How far ahead the grid scrolls. */
export const GUIDE_HOURS = 12
export const PX_PER_HOUR = 240
export const ROW_H = 64
export const CHANNEL_COL_W = 220

export const CATEGORY_ORDER: Array<Exclude<GuideCategory, 'all'>> = ['sports', 'news', 'entertainment', 'other']

const CATEGORY_LABEL: Record<GuideCategory, string> = {
  all: 'All',
  sports: 'Sports',
  news: 'News',
  entertainment: 'Entertainment',
  other: 'Other',
}

export function categoryLabel(category: GuideCategory): string {
  return CATEGORY_LABEL[category]
}

/** The guide's left edge: the most recent :00 or :30 in local time. */
export function floorToSlot(ms: number): number {
  const d = new Date(ms)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
  return d.getTime()
}

export interface GuideWindow {
  start: number
  end: number
}

export function guideWindow(now: number, hours: number = GUIDE_HOURS): GuideWindow {
  const start = floorToSlot(now)
  return { start, end: start + hours * HOUR_MS }
}

/** Horizontal offset of a moment from the window's left edge. */
export function xFor(ms: number, windowStart: number, pxPerHour: number = PX_PER_HOUR): number {
  return ((ms - windowStart) / HOUR_MS) * pxPerHour
}

/** Every 30-minute tick in the window, left edge included, right edge excluded. */
export function slotTicks(win: GuideWindow): number[] {
  const out: number[] = []
  for (let t = win.start; t < win.end; t += SLOT_MS) out.push(t)
  return out
}

/**
 * Where a program lands in the window, clipped to its edges. Null when it
 * falls entirely outside. `clippedStart` is true when the program began before
 * the window (so the block shouldn't pretend that's its real start).
 */
export function placeBlock(
  program: ProgramLike,
  win: GuideWindow,
  pxPerHour: number = PX_PER_HOUR
): { left: number; width: number; clippedStart: boolean } | null {
  if (program.end <= win.start || program.start >= win.end) return null
  const from = Math.max(program.start, win.start)
  const to = Math.min(program.end, win.end)
  return {
    left: xFor(from, win.start, pxPerHour),
    width: xFor(to, win.start, pxPerHour) - xFor(from, win.start, pxPerHour),
    clippedStart: program.start < win.start,
  }
}

/** A channel's programs, earliest first. */
export function programsFor<P extends ProgramLike>(programs: P[], channelId: string): P[] {
  return programs.filter((p) => p.channelId === channelId).sort((a, b) => a.start - b.start)
}

/** What's airing now. When listings overlap, the one that started latest wins. */
export function currentProgram<P extends ProgramLike>(programs: P[], channelId: string, now: number): P | undefined {
  let best: P | undefined
  for (const p of programs) {
    if (p.channelId !== channelId || p.start > now || p.end <= now) continue
    if (!best || p.start > best.start) best = p
  }
  return best
}

/**
 * What the channel is showing, as a viewer would say it. A live game wins even
 * past its listed end — listings pad games to a fixed length, and overtime
 * doesn't stop because the guide says the next show has started.
 */
export function onNow<P extends ProgramLike & { gameId?: string }>(
  programs: P[],
  channelId: string,
  now: number,
  liveGameIds: Set<string>
): P | undefined {
  const live = programs.find(
    (p) => p.channelId === channelId && p.gameId !== undefined && liveGameIds.has(p.gameId) && p.start <= now
  )
  return live ?? currentProgram(programs, channelId, now)
}

/** Channels carrying a game that is live right now. */
export function liveChannelIds(programs: Array<ProgramLike & { gameId?: string }>, liveGameIds: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const p of programs) if (p.gameId !== undefined && liveGameIds.has(p.gameId)) out.add(p.channelId)
  return out
}

/** The first program to start after now. */
export function nextProgram<P extends ProgramLike>(programs: P[], channelId: string, now: number): P | undefined {
  let best: P | undefined
  for (const p of programs) {
    if (p.channelId !== channelId || p.start <= now) continue
    if (!best || p.start < best.start) best = p
  }
  return best
}

/** 0–1 through a program; clamped. */
export function progressOf(program: ProgramLike, now: number): number {
  const span = program.end - program.start
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (now - program.start) / span))
}

/**
 * Guide order: channels carrying a live game first, then by category
 * (sports, news, entertainment, other), then by name.
 */
export function sortChannels<C extends ChannelLike>(channels: C[], liveChannelIds: Set<string>): C[] {
  const rank = (c: C) => CATEGORY_ORDER.indexOf(c.category)
  return [...channels].sort((a, b) => {
    const live = Number(liveChannelIds.has(b.channelId)) - Number(liveChannelIds.has(a.channelId))
    if (live !== 0) return live
    const cat = rank(a) - rank(b)
    if (cat !== 0) return cat
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  })
}

/** Category plus a case-insensitive name match; whitespace-only queries match everything. */
export function filterChannels<C extends ChannelLike>(channels: C[], category: GuideCategory, query: string): C[] {
  const q = query.trim().toLowerCase()
  return channels.filter(
    (c) => (category === 'all' || c.category === category) && (q === '' || c.name.toLowerCase().includes(q))
  )
}

/**
 * A channel's monogram: an all-caps short name keeps its letters (CNN, ESPN,
 * A&E), anything else takes the initials of its first two words.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]
  if (first.length <= 5 && /[A-Z]/.test(first) && first === first.toUpperCase()) return first
  if (words.length === 1) return first.slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** A stable hue from a channel's name, so its tile keeps its color across launches. */
export function channelHue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
