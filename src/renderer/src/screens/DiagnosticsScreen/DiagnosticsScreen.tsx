import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import styles from './DiagnosticsScreen.module.css'

function formatRelativeTime(timestampMs: number | null): string {
  if (timestampMs === null) return 'Never'
  const diffMs = Date.now() - timestampMs
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`
}

function getHealthClass(healthState: HealthState): string {
  switch (healthState) {
    case 'healthy': return styles.healthHealthy
    case 'degraded': return styles.healthDegraded
    case 'blocked': return styles.healthBlocked
    case 'broken': return styles.healthBroken
    default: return styles.healthUnknown
  }
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

function formatEventType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function getEventTypeClass(type: string): string {
  if (type.includes('fail') || type.includes('error') || type === 'all_sources_failed') {
    return styles.eventFailed
  }
  if (type.includes('start') || type.includes('success')) {
    return styles.eventSuccess
  }
  return styles.eventNeutral
}

export function DiagnosticsScreen(): React.JSX.Element {
  const [data, setData] = useState<DiagnosticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.onair.getDiagnostics()
      setData(result)
    } catch {
      setError('Diagnostics unavailable')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDiagnostics()
  }, [fetchDiagnostics])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Diagnostics</h1>
        <button
          className={styles.refreshButton}
          onClick={fetchDiagnostics}
          aria-label="Refresh diagnostics"
          disabled={loading}
        >
          <RefreshCw size={20} className={loading ? styles.spinning : undefined} />
        </button>
      </div>

      {error && (
        <div className={styles.errorState}>
          <p className={styles.errorText}>{error}</p>
        </div>
      )}

      {!error && data && (
        <>
          {/* Sources Table */}
          <div className={styles.glassCard}>
            <h2 className={styles.cardTitle}>Sources</h2>
            {data.sources.length === 0 ? (
              <p className={styles.emptyText}>No sources available.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Name</th>
                      <th className={styles.th}>Health</th>
                      <th className={styles.th}>Confidence</th>
                      <th className={styles.th}>Enabled</th>
                      <th className={styles.th}>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((source) => (
                      <tr key={source.sourceId} className={styles.tr}>
                        <td className={styles.tdName}>{source.name}</td>
                        <td className={styles.td}>
                          <span className={`${styles.healthBadge} ${getHealthClass(source.healthState)}`}>
                            {source.healthState}
                          </span>
                        </td>
                        <td className={styles.tdSecondary}>
                          {Math.round(source.confidenceWeight * 100)}%
                        </td>
                        <td className={styles.td}>
                          <span
                            className={source.enabled ? styles.enabledDot : styles.disabledDot}
                            aria-label={source.enabled ? 'Enabled' : 'Disabled'}
                          />
                        </td>
                        <td className={styles.tdTertiary}>
                          {formatRelativeTime(source.healthUpdatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Events */}
          <div className={styles.glassCard}>
            <h2 className={styles.cardTitle}>Recent Events</h2>
            {!data.recentEvents || data.recentEvents.length === 0 ? (
              <p className={styles.emptyText}>No recent events.</p>
            ) : (
              <div className={styles.eventsList}>
                {data.recentEvents.slice(0, 20).map((event) => {
                  const details = parseDetails(event.details)
                  return (
                    <div key={event.id} className={styles.eventRow}>
                      <span className={`${styles.eventTypeBadge} ${getEventTypeClass(event.eventType)}`}>
                        {formatEventType(event.eventType)}
                      </span>
                      <span className={styles.eventTime}>{formatRelativeTime(event.occurredAt)}</span>
                      {Object.keys(details).length > 0 && (
                        <span className={styles.eventDetails}>
                          {Object.entries(details)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}
