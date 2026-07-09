import { Component, type ErrorInfo, type ReactNode } from 'react'
import EmptyState from './EmptyState'

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
          <EmptyState
            message="Something broke"
            hint={this.state.error.message}
            action={
              <button
                className="btn btn-ember btn-sm"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
