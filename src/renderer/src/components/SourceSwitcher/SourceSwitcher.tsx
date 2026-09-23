import React, { useState, useEffect } from 'react'
import styles from './SourceSwitcher.module.css'

interface SourceSwitcherProps {
  gameId: string
  open: boolean
  /** The candidate currently on screen, so the list marks the right row. */
  activeCandidateId: string | null
  onOpen: () => void
  onClose: () => void
  /** Switches playback to the candidate; resolves true once it is loading. */
  onSelect: (candidateId: string) => Promise<boolean>
}

export function SourceSwitcher({
  gameId,
  open,
  activeCandidateId,
  onOpen,
  onClose,
  onSelect,
}: SourceSwitcherProps): React.JSX.Element {
  const [candidates, setCandidates] = useState<StreamCandidate[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return

    setLoading(true)
    Promise.all([
      window.onair.getCandidatesForGame(gameId).catch(() => [] as StreamCandidate[]),
      window.onair.getSources().catch(() => [] as Source[]),
    ]).then(([cands, srcs]) => {
      setCandidates(cands)
      setSources(srcs)
      setLoading(false)
    })
  }, [open, gameId])

  const handleRowClick = async (candidate: StreamCandidate) => {
    if (candidate.candidateId === activeCandidateId) return
    const switched = await onSelect(candidate.candidateId)
    if (switched) onClose()
    // On failure the panel stays open so another source can be tried
  }

  const getSourceName = (candidate: StreamCandidate): string => {
    return sources.find((s) => s.sourceId === candidate.sourceId)?.name ?? candidate.sourceId
  }

  return (
    <div className={styles.wrapper}>
      {/* Trigger button */}
      <button
        className={styles.triggerButton}
        onClick={() => (open ? onClose() : onOpen())}
        aria-label="Switch stream source"
        aria-expanded={open}
      >
        ⇄ Switch Source
      </button>

      {/* Expanded panel */}
      <div
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
        aria-hidden={!open}
      >
        {loading && (
          <p className={styles.emptyText}>Loading sources...</p>
        )}

        {!loading && candidates.length === 0 && (
          <p className={styles.emptyText}>No sources available</p>
        )}

        {!loading && candidates.length > 0 && (
          <ul
            role="listbox"
            className={styles.list}
            aria-label="Available stream sources"
          >
            {candidates.map((candidate) => {
              const isActive = candidate.candidateId === activeCandidateId
              const sourceName = getSourceName(candidate)
              const qualityLabel = candidate.quality ?? 'Unknown'
              const reliabilityWidth = `${Math.round(candidate.score * 100)}%`

              return (
                <li
                  key={candidate.candidateId}
                  role="option"
                  aria-selected={isActive}
                  className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  onClick={() => void handleRowClick(candidate)}
                >
                  {/* Active indicator */}
                  <span
                    className={`${styles.activeIndicator} ${isActive ? styles.activeIndicatorOn : ''}`}
                    aria-hidden="true"
                  />

                  {/* Source name */}
                  <span className={styles.sourceName}>{sourceName}</span>

                  {/* Quality badge */}
                  <span className={styles.qualityBadge}>{qualityLabel}</span>

                  {/* Reliability bar */}
                  <div className={styles.reliabilityTrack} aria-hidden="true">
                    <div
                      className={styles.reliabilityBar}
                      style={{ width: reliabilityWidth }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Close button */}
        {open && (
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close source picker"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
