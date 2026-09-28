const DAY_MS = 86_400_000

function startOfDay(ms: number): number {
  return new Date(ms).setHours(0, 0, 0, 0)
}

function dayDiff(ms: number, now: number): number {
  return Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS)
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "8:20 PM" today, "Tomorrow 8:20 PM", "Sat 12:00 PM" this week, "Oct 12 · 1:00 PM" beyond. */
export function formatKickoff(ms: number, now: number = Date.now()): string {
  const diff = dayDiff(ms, now)
  const time = formatClock(ms)
  if (diff === 0) return time
  if (diff === 1) return `Tomorrow ${time}`
  if (diff > 1 && diff < 7) {
    return `${new Date(ms).toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
  }
  return `${new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`
}

export type DayBucket = 'today' | 'tomorrow' | 'week' | 'later'

export function dayBucket(ms: number, now: number = Date.now()): DayBucket {
  const diff = dayDiff(ms, now)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff < 7) return 'week'
  return 'later'
}

/** "in 38 min", "in 2 hr", "in 3 days". */
export function countdown(ms: number, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((ms - now) / 60_000))
  if (min < 1) return 'any moment'
  if (min < 60) return `in ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `in ${hr} hr`
  const days = Math.round(hr / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export function formatRelative(ms: number | null, now: number = Date.now()): string {
  if (ms === null) return 'never'
  const sec = Math.max(0, Math.floor((now - ms) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

/** "4:07", "42:18", "1:02:05". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
