import React from 'react'
import type { UsePlaybackReturn } from '../hooks/usePlayback'

type PlayerProps = Pick<UsePlaybackReturn, 'video0Ref' | 'video1Ref' | 'slot0IsActive' | 'playerState' | 'errorReason'>

export default function Player({ video0Ref, video1Ref, slot0IsActive, playerState, errorReason }: PlayerProps): React.JSX.Element {

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {/* Slot 0 — visible when playing and slot 0 is active */}
      <video
        ref={video0Ref}
        style={{
          display: playerState === 'playing' && slot0IsActive ? 'block' : 'none',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        playsInline
      />

      {/* Slot 1 — visible when playing and slot 1 is active */}
      <video
        ref={video1Ref}
        style={{
          display: playerState === 'playing' && !slot0IsActive ? 'block' : 'none',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
        playsInline
      />

      {/* Loading indicator */}
      {playerState === 'loading' && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#fff',
          fontSize: '18px',
        }}>
          Loading stream...
        </div>
      )}

      {/* Error state */}
      {playerState === 'error' && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#fff',
          fontSize: '18px',
          textAlign: 'center',
        }}>
          <div>Stream unavailable</div>
          {errorReason && (
            <div style={{ fontSize: '14px', color: '#888', marginTop: '8px' }}>
              {errorReason}
            </div>
          )}
        </div>
      )}

      {/* Idle state */}
      {playerState === 'idle' && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#666',
          fontSize: '16px',
        }}>
          Select a game to start watching
        </div>
      )}
    </div>
  )
}
