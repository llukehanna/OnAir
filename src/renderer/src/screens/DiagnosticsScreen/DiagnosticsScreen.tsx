import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { formatRelative } from '../../lib/time'
import styles from './DiagnosticsScreen.module.css'

const REFRESH_MS = 10_000

const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  blocked: 'Blocked',
  broken: 'Broken',
  unknown: 'Not checked yet',
}

/** Event details are stored as a JSON string; anything unparseable shows nothing. */
function parseDetails(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function humanize(type: string): string {
  const s = type.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Tone = 'bad' | 'ok' | 'neutral'

function toneOf(type: string): Tone {
  if (type.includes('fail') || type.includes('error') || type.includes('stall')) return 'bad'
  if (type.includes('start') || type.includes('success')) return 'ok'
  return 'neutral'
}

export function DiagnosticsScreen(): React.JSX.Element {
  const [data, setData] = useState<DiagnosticsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDiagnostics = useCallback(async (manual = false) => {
    if (manual) setLoading(true)
    try {
      setData(await window.onair.getDiagnostics())
      setError(null)
    } catch {
      setError('Diagnostics are unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDiagnostics()
    const t = setInterval(() => void fetchDiagnostics(), REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchDiagnostics])

  const sources = data?.sources ?? []
  const events = (data?.recentEvents ?? []).slice(0, 30)
  const healthy = sources.filter((s) => s.healthState === 'healthy').length

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Diagnostics</h1>
          <p className={styles.subtitle}>
            {data
              ? `${healthy} of ${sources.length} source${sources.length === 1 ? '' : 's'} healthy · ${
                  events[0] ? `last event ${formatRelative(events[0].occurredAt)}` : 'no events yet'
                }`
              : 'Source health and playback history'}
          </p>
        </div>
        <button className={styles.refresh} onClick={() => void fetchDiagnostics(true)} disabled={loading} aria-label="Refresh diagnostics">
          <RefreshCw size={15} strokeWidth={2} className={loading ? styles.spinning : undefined} />
          Refresh
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Sources</h2>
        {data && sources.length === 0 && <p className={styles.empty}>No sources registered.</p>}
        <div className={styles.sources}>
          {sources.map((s) => (
            <article key={s.sourceId} className={`${styles.source} ${s.enabled ? '' : styles.disabled}`}>
              <div className={styles.sourceTop}>
                <h3 className={styles.sourceName}>{s.name}</h3>
                <span className={`${styles.health} ${styles[`h_${s.healthState}`]}`}>
                  <span className={styles.healthDot} aria-hidden="true" />
                  {HEALTH_LABEL[s.healthState]}
                </span>
              </div>
              <div className={styles.meter}>
                <div className={styles.meterLabel}>
                  <span>Confidence</span>
                  <span className={styles.mono}>{Math.round(s.confidenceWeight * 100)}%</span>
                </div>
                <div className={styles.track}>
                  <span style={{ width: `${Math.round(s.confidenceWeight * 100)}%` }} />
                </div>
              </div>
              <div className={styles.sourceFoot}>
                <span>{s.enabled ? 'Enabled' : 'Disabled'}</span>
                <span className={styles.mono}>Checked {formatRelative(s.healthUpdatedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent events</h2>
        {data && events.length === 0 && <p className={styles.empty}>Nothing has happened yet. Play a game and switches show up here.</p>}
        <ol className={styles.timeline}>
          {events.map((ev) => {
            const details = Object.entries(parseDetails(ev.details)).slice(0, 4)
            return (
              <li key={ev.id} className={`${styles.event} ${styles[`t_${toneOf(ev.eventType)}`]}`}>
                <span className={styles.eventDot} aria-hidden="true" />
                <div className={styles.eventBody}>
                  <span className={styles.eventType}>{humanize(ev.eventType)}</span>
                  {details.length > 0 && (
                    <span className={styles.eventDetails}>
                      {details.map(([k, v]) => `${k.replace(/_/g, ' ')} ${String(v)}`).join(' · ')}
                    </span>
                  )}
                </div>
                <time className={styles.eventTime}>{formatRelative(ev.occurredAt)}</time>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
