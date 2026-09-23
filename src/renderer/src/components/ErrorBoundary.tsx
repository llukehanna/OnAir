import React from 'react'

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
        <div style={{ padding: 40, color: '#ff4444', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2 style={{ color: '#ff6666' }}>UI Crash</h2>
          <p><strong>{this.state.error.message}</strong></p>
          <pre style={{ fontSize: 12, color: '#999', maxHeight: '60vh', overflow: 'auto' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
