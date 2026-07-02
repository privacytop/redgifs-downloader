import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Reset the boundary when this value changes (e.g. the active route). */
  resetKey?: unknown
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/lifecycle crashes in the page tree so a single broken page
 * shows a recoverable message instead of unmounting the whole app to a blank
 * dark screen. Resets automatically when `resetKey` (the route) changes.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it in the devtools console for debugging.
    console.error('Page crashed:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="page">
          <div
            style={{
              margin: '40px auto',
              maxWidth: 480,
              textAlign: 'center',
              fontFamily: 'var(--mono)',
              color: 'var(--mut)'
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>
            <div style={{ fontSize: 15, color: 'var(--cream)', marginBottom: 8 }}>
              This page hit an error
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 18 }}>
              {this.state.error.message}
            </div>
            <button className="btn btn-ember btn-sm" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
