import React from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 48, background: 'var(--bg)' }}>
          <div style={{ maxWidth: 640, width: '100%' }}>
            <TriangleAlert size={28} strokeWidth={1.8} color="var(--warn)" aria-hidden="true" style={{ marginBottom: 16 }} />
            <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em' }}>Something broke in the interface</h2>
            <p style={{ marginTop: 8, color: 'var(--ink-2)', fontSize: 15 }}>{this.state.error.message}</p>
            <pre style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'var(--bg-raised)', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11.5, maxHeight: '45vh', overflow: 'auto', whiteSpace: 'pre-wrap', userSelect: 'text' }}>
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ marginTop: 20, height: 40, padding: '0 20px', borderRadius: 999, background: 'var(--ink)', color: '#0b0b0c', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <RotateCw size={15} strokeWidth={2.2} />
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
