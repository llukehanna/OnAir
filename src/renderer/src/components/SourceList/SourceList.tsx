import React, { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import styles from './SourceList.module.css'

interface SourceListProps {
  gameId: string
  /** The candidate on screen; its row is marked. */
  activeCandidateId: string | null
  /** Switches playback; resolves true once the new stream is loading. */
  onSelect: (candidateId: string) => Promise<boolean>
}

interface Row {
  candidate: StreamCandidate
  sourceName: string
}

export function SourceList({ gameId, activeCandidateId, onSelect }: SourceListProps): React.JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // Candidates are re-ranked as streams fail, so refresh when the active one changes.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.onair.getCandidatesForGame(gameId).catch(() => [] as StreamCandidate[]),
      window.onair.getSources().catch(() => [] as Source[]),
    ]).then(([candidates, sources]) => {
      if (cancelled) return
      const nameOf = (id: string) => sources.find((s) => s.sourceId === id)?.name ?? id
      setRows(
        [...candidates]
          .sort((a, b) => b.score - a.score)
          .map((candidate) => ({ candidate, sourceName: nameOf(candidate.sourceId) }))
      )
    })
    return () => {
      cancelled = true
    }
  }, [gameId, activeCandidateId])

  const choose = async (id: string) => {
    if (id === activeCandidateId || pending) return
    setPending(id)
    setFailed(null)
    const ok = await onSelect(id)
    setPending(null)
    if (!ok) setFailed(id)
  }

  if (rows === null) {
    return (
      <div className={styles.list} aria-busy="true">
        {[0, 1, 2].map((i) => <span key={i} className={styles.skeleton} />)}
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className={styles.empty}>No sources have this game yet.</p>
  }

  return (
    <ul className={styles.list} role="listbox" aria-label="Stream sources">
      {rows.map(({ candidate, sourceName }) => {
        const active = candidate.candidateId === activeCandidateId
        const isPending = candidate.candidateId === pending
        const didFail = candidate.candidateId === failed
        return (
          <li key={candidate.candidateId} role="option" aria-selected={active}>
            <button
              className={`${styles.row} ${active ? styles.active : ''}`}
              onClick={() => void choose(candidate.candidateId)}
              disabled={active}
            >
              <span className={styles.name}>
                {sourceName}
                <span className={styles.meta}>
                  {didFail ? <span className={styles.fail}>Couldn’t switch</span> : candidate.quality ?? 'Auto'}
                </span>
              </span>
              <span className={styles.score} title="Reliability">
                <span className={styles.bar}>
                  <span style={{ width: `${Math.round(candidate.score * 100)}%` }} />
                </span>
              </span>
              <span className={styles.state} aria-hidden="true">
                {isPending ? <LoaderCircle size={16} className={styles.spin} /> : active ? <Check size={16} strokeWidth={2.4} /> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
